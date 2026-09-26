/**
 * API de RSVP — casamento de Julia e Fábio.
 *
 * Este arquivo deve ser copiado para um projeto do Google Apps Script vinculado
 * à planilha oficial. Consulte o README antes de publicar o Web App.
 */

const RSVP_CONFIG = Object.freeze({
  minQueryLength: 3,
  maxQueryLength: 80,
  maxResults: 10,
  maxRequestBytes: 2048,
  lockTimeoutMs: 10000,
  searchCacheKey: 'guest-search-v2',
  searchCacheTtlSeconds: 300,
  defaultSheetName: 'Convidados',
  defaultHeaderRow: 1,
  statuses: Object.freeze({
    pending: 'PENDENTE',
    confirmed: 'CONFIRMADO',
    declined: 'NÃO VAI',
  }),
  headerAliases: Object.freeze({
    id: Object.freeze(['id']),
    name: Object.freeze(['nome']),
    status: Object.freeze(['status', 'presenca']),
    confirmedAt: Object.freeze(['confirmadoem']),
    identification: Object.freeze(['identificacao']),
  }),
});

/**
 * GET /exec?action=health
 * GET /exec?action=search&q=maria
 */
function doGet(e) {
  try {
    const action = getRequestParameter_(e, 'action');

    if (action === 'health') {
      // Valida também a planilha, os cabeçalhos, IDs e status existentes.
      const bundle = getGuestRecords_();
      putSearchRecordsInCache_(bundle.records);
      return jsonResponse_({ success: true, status: 'ok' });
    }

    if (action === 'search') {
      return jsonResponse_({
        success: true,
        results: searchGuests_(getRequestParameter_(e, 'q')),
      });
    }

    throw new ApiError_('INVALID_ACTION', 'Ação inválida.');
  } catch (error) {
    return errorResponse_(error);
  }
}

/**
 * POST /exec
 * Content-Type: text/plain;charset=UTF-8
 * Corpo: {"action":"rsvp","id":"18","attending":true}
 */
function doPost(e) {
  try {
    const payload = parseRsvpPayload_(e);
    return jsonResponse_(updateRsvp_(payload.id, payload.attending));
  } catch (error) {
    return errorResponse_(error);
  }
}

/**
 * Diagnóstico seguro para executar manualmente no editor do Apps Script.
 * Não é exposto pela API pública e não retorna nomes nem IDs de convidados.
 */
function inspectSheetStructure() {
  const settings = getScriptSettings_();
  const spreadsheet = getSpreadsheet_(settings.spreadsheetId);
  const result = spreadsheet.getSheets().map(function (sheet) {
    const dataRange = sheet.getDataRange();
    const lastColumn = dataRange.getLastColumn();
    const lastRow = dataRange.getLastRow();
    const headers = lastColumn > 0 && lastRow >= settings.headerRow
      ? sheet.getRange(settings.headerRow, 1, 1, lastColumn).getDisplayValues()[0]
      : [];

    return {
      sheetName: sheet.getName(),
      headerRow: settings.headerRow,
      headers: headers,
      dataRows: Math.max(0, lastRow - settings.headerRow),
    };
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Validação completa para executar manualmente antes da publicação.
 * Retorna apenas totais e a estrutura, nunca dados pessoais.
 */
function validateConfiguration() {
  const bundle = getGuestRecords_();
  const duplicateGroups = Object.create(null);

  bundle.records.forEach(function (record) {
    duplicateGroups[record.normalizedName] =
      (duplicateGroups[record.normalizedName] || 0) + 1;
  });

  const duplicateNames = Object.keys(duplicateGroups).filter(function (key) {
    return duplicateGroups[key] > 1;
  });

  const duplicateRowsWithoutIdentification = bundle.records.filter(function (record) {
    return duplicateGroups[record.normalizedName] > 1 && !record.identification;
  }).length;

  const result = {
    success: true,
    sheetName: bundle.context.sheet.getName(),
    headerRow: bundle.context.headerRow,
    columns: bundle.context.headerNames,
    guestCount: bundle.records.length,
    duplicateNameGroups: duplicateNames.length,
    duplicateRowsWithoutIdentification: duplicateRowsWithoutIdentification,
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function searchGuests_(query) {
  const normalizedQuery = normalizeText_(query);

  if (normalizedQuery.length < RSVP_CONFIG.minQueryLength) {
    throw new ApiError_(
      'QUERY_TOO_SHORT',
      'Digite pelo menos ' + RSVP_CONFIG.minQueryLength + ' caracteres.'
    );
  }

  if (normalizedQuery.length > RSVP_CONFIG.maxQueryLength) {
    throw new ApiError_('QUERY_TOO_LONG', 'O nome digitado é muito longo.');
  }

  const records = getSearchRecords_();
  const exactNameCounts = Object.create(null);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  records.forEach(function (record) {
    exactNameCounts[record.normalizedName] =
      (exactNameCounts[record.normalizedName] || 0) + 1;
  });

  return records
    .map(function (record) {
      return {
        record: record,
        score: getMatchScore_(record.normalizedName, normalizedQuery, queryTokens),
      };
    })
    .filter(function (match) {
      return match.score !== null;
    })
    .sort(function (a, b) {
      return a.score - b.score || a.record.name.localeCompare(b.record.name, 'pt-BR');
    })
    .slice(0, RSVP_CONFIG.maxResults)
    .map(function (match) {
      const record = match.record;
      const result = {
        id: record.id,
        name: record.name,
        status: record.status,
      };

      if (exactNameCounts[record.normalizedName] > 1 && record.identification) {
        result.identification = record.identification;
      }

      return result;
    });
}

function getMatchScore_(normalizedName, normalizedQuery, queryTokens) {
  if (normalizedName === normalizedQuery) {
    return 0;
  }

  if (normalizedName.indexOf(normalizedQuery) === 0) {
    return 1;
  }

  if (normalizedName.indexOf(normalizedQuery) !== -1) {
    return 2;
  }

  const everyTokenMatches = queryTokens.every(function (token) {
    return normalizedName.indexOf(token) !== -1;
  });

  return everyTokenMatches ? 3 : null;
}

function updateRsvp_(id, attending) {
  const lock = LockService.getScriptLock();
  let acquired = false;

  try {
    acquired = lock.tryLock(RSVP_CONFIG.lockTimeoutMs);
    if (!acquired) {
      throw new ApiError_(
        'BUSY',
        'Estamos recebendo outra confirmação. Tente novamente em alguns instantes.'
      );
    }

    const context = getSheetContext_();
    const cachedMatch = getCachedGuestForUpdate_(context, id);
    let guest;
    let records;

    if (cachedMatch) {
      guest = cachedMatch.guest;
      records = cachedMatch.records;
    } else {
      const bundle = getGuestRecords_(context);
      records = bundle.records;
      guest = records.find(function (record) {
        return record.id === id;
      });
    }

    if (!guest) {
      throw new ApiError_('GUEST_NOT_FOUND', 'Convidado não encontrado.');
    }

    const nextStatus = attending
      ? RSVP_CONFIG.statuses.confirmed
      : RSVP_CONFIG.statuses.declined;
    writeRsvpValues_(context, guest.rowNumber, nextStatus);

    // Reaproveita os dados já lidos e mantém o cache aquecido após a gravação.
    guest.status = nextStatus;
    putSearchRecordsInCache_(records);

    return {
      success: true,
      id: guest.id,
      status: nextStatus,
    };
  } finally {
    if (acquired) {
      lock.releaseLock();
    }
  }
}

/**
 * Usa a linha guardada no cache somente depois de conferir o ID diretamente na
 * planilha. Se linhas tiverem sido inseridas ou removidas, a leitura completa é
 * refeita antes de qualquer gravação.
 */
function getCachedGuestForUpdate_(context, id) {
  const records = getSearchRecordsFromCache_();
  if (records === null) {
    return null;
  }

  const guest = records.find(function (record) {
    return record.id === id;
  });

  if (
    !guest ||
    !Number.isInteger(guest.rowNumber) ||
    guest.rowNumber <= context.headerRow ||
    guest.rowNumber > context.lastRow
  ) {
    return null;
  }

  const currentId = cellText_(
    context.sheet
      .getRange(guest.rowNumber, context.columns.id + 1)
      .getDisplayValue()
  );

  return currentId === id ? { guest: guest, records: records } : null;
}

function writeRsvpValues_(context, rowNumber, nextStatus) {
  const statusColumn = context.columns.status;
  const confirmedAtColumn = context.columns.confirmedAt;
  const firstColumn = Math.min(statusColumn, confirmedAtColumn);
  const lastColumn = Math.max(statusColumn, confirmedAtColumn);

  // Na estrutura oficial, Status e ConfirmadoEm são adjacentes. Os dois valores
  // são gravados em uma única operação, sem uma leitura prévia da linha.
  if (lastColumn - firstColumn === 1) {
    const nextValues = statusColumn < confirmedAtColumn
      ? [nextStatus, new Date()]
      : [new Date(), nextStatus];

    context.sheet
      .getRange(rowNumber, firstColumn + 1, 1, 2)
      .setValues([nextValues]);
    SpreadsheetApp.flush();
    return;
  }

  // Compatibilidade para planilhas que tenham essas colunas separadas.
  const statusRange = context.sheet.getRange(rowNumber, statusColumn + 1);
  const confirmedAtRange = context.sheet.getRange(rowNumber, confirmedAtColumn + 1);
  const previousStatus = statusRange.getValue();
  const previousConfirmedAt = confirmedAtRange.getValue();

  try {
    statusRange.setValue(nextStatus);
    confirmedAtRange.setValue(new Date());
    SpreadsheetApp.flush();
  } catch (writeError) {
    try {
      statusRange.setValue(previousStatus);
      confirmedAtRange.setValue(previousConfirmedAt);
      SpreadsheetApp.flush();
    } catch (rollbackError) {
      console.error('Falha ao reverter atualização de RSVP: ' + rollbackError.message);
    }
    throw writeError;
  }
}

function getSearchRecords_() {
  const cachedRecords = getSearchRecordsFromCache_();
  if (cachedRecords !== null) {
    return cachedRecords;
  }

  const records = getGuestRecords_().records;
  putSearchRecordsInCache_(records);
  return records;
}

function getSearchRecordsFromCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const cachedValue = cache.get(RSVP_CONFIG.searchCacheKey);
    if (!cachedValue) {
      return null;
    }

    const records = JSON.parse(cachedValue);
    const valid = Array.isArray(records) && records.every(function (record) {
      return record &&
        typeof record.id === 'string' &&
        typeof record.name === 'string' &&
        typeof record.normalizedName === 'string' &&
        typeof record.status === 'string' &&
        Number.isInteger(record.rowNumber);
    });

    if (!valid) {
      cache.remove(RSVP_CONFIG.searchCacheKey);
      return null;
    }
    return records;
  } catch (error) {
    console.error('Falha ao ler cache de busca: ' + error.message);
    return null;
  }
}

function putSearchRecordsInCache_(records) {
  const cacheRecords = records.map(function (record) {
    return {
      id: record.id,
      name: record.name,
      normalizedName: record.normalizedName,
      status: record.status,
      identification: record.identification,
      rowNumber: record.rowNumber,
    };
  });

  try {
    CacheService.getScriptCache().put(
      RSVP_CONFIG.searchCacheKey,
      JSON.stringify(cacheRecords),
      RSVP_CONFIG.searchCacheTtlSeconds
    );
  } catch (error) {
    // Cache é uma otimização: sua indisponibilidade não pode derrubar a API.
    console.error('Falha ao atualizar cache de busca: ' + error.message);
  }
}

function parseRsvpPayload_(e) {
  const contents = e && e.postData && e.postData.contents;

  if (!contents) {
    throw new ApiError_('INVALID_PAYLOAD', 'Não foi possível ler sua resposta.');
  }

  if (contents.length > RSVP_CONFIG.maxRequestBytes) {
    throw new ApiError_('PAYLOAD_TOO_LARGE', 'A resposta enviada é muito grande.');
  }

  let payload;
  try {
    payload = JSON.parse(contents);
  } catch (error) {
    throw new ApiError_('INVALID_JSON', 'Não foi possível ler sua resposta.');
  }

  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new ApiError_('INVALID_PAYLOAD', 'Não foi possível ler sua resposta.');
  }

  const allowedKeys = { action: true, id: true, attending: true };
  Object.keys(payload).forEach(function (key) {
    if (!allowedKeys[key]) {
      throw new ApiError_('INVALID_PAYLOAD', 'A resposta contém campos inválidos.');
    }
  });

  if (payload.action !== undefined && payload.action !== 'rsvp') {
    throw new ApiError_('INVALID_ACTION', 'Ação inválida.');
  }

  const id = String(payload.id === undefined ? '' : payload.id).trim();
  if (!id || id.length > 128) {
    throw new ApiError_('INVALID_ID', 'Identificação de convidado inválida.');
  }

  if (typeof payload.attending !== 'boolean') {
    throw new ApiError_('INVALID_ATTENDING', 'Escolha se você poderá comparecer.');
  }

  return { id: id, attending: payload.attending };
}

function getGuestRecords_(existingContext) {
  const context = existingContext || getSheetContext_();

  if (context.lastRow <= context.headerRow) {
    return { context: context, records: [] };
  }

  // Lê somente o intervalo necessário para ID, Nome, Status e Identificação.
  // Colunas de resumo e ConfirmadoEm não participam da busca.
  const values = context.sheet
    .getRange(
      context.headerRow + 1,
      context.recordFirstColumn + 1,
      context.lastRow - context.headerRow,
      context.recordLastColumn - context.recordFirstColumn + 1
    )
    .getDisplayValues();
  const seenIds = Object.create(null);
  const records = [];

  values.forEach(function (row, index) {
    const valueAt = function (columnIndex) {
      return row[columnIndex - context.recordFirstColumn];
    };
    const rawId = cellText_(valueAt(context.columns.id));
    const name = cellText_(valueAt(context.columns.name));
    const rawStatus = cellText_(valueAt(context.columns.status));
    const identification = context.columns.identification === null
      ? ''
      : cellText_(valueAt(context.columns.identification));
    const rowNumber = context.headerRow + index + 1;

    if (!rawId && !name && !rawStatus && !identification) {
      return;
    }

    if (!rawId || !name) {
      throw new Error('Configuração inválida: ID ou Nome vazio na linha ' + rowNumber + '.');
    }

    if (seenIds[rawId]) {
      throw new Error('Configuração inválida: ID duplicado na linha ' + rowNumber + '.');
    }

    seenIds[rawId] = true;
    records.push({
      id: rawId,
      name: name,
      normalizedName: normalizeText_(name),
      status: normalizeStatus_(rawStatus, rowNumber),
      identification: identification,
      rowNumber: rowNumber,
    });
  });

  return { context: context, records: records };
}

function getSheetContext_() {
  const settings = getScriptSettings_();
  const spreadsheet = getSpreadsheet_(settings.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(settings.sheetName);

  if (!sheet) {
    throw new Error('A aba configurada não foi encontrada: ' + settings.sheetName + '.');
  }

  return readSheetContext_(sheet, settings.headerRow);
}

function readSheetContext_(sheet, headerRow) {
  const dataRange = sheet.getDataRange();
  const lastColumn = dataRange.getLastColumn();
  const lastRow = dataRange.getLastRow();

  if (lastColumn < 1 || lastRow < headerRow) {
    throw new Error('A aba não possui cabeçalhos.');
  }

  const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0];
  const normalizedHeaders = headers.map(normalizeHeader_);
  const columns = {
    id: resolveHeaderIndex_(normalizedHeaders, RSVP_CONFIG.headerAliases.id, true),
    name: resolveHeaderIndex_(normalizedHeaders, RSVP_CONFIG.headerAliases.name, true),
    status: resolveHeaderIndex_(normalizedHeaders, RSVP_CONFIG.headerAliases.status, true),
    confirmedAt: resolveHeaderIndex_(
      normalizedHeaders,
      RSVP_CONFIG.headerAliases.confirmedAt,
      true
    ),
    identification: resolveHeaderIndex_(
      normalizedHeaders,
      RSVP_CONFIG.headerAliases.identification,
      false
    ),
  };
  const recordColumns = [columns.id, columns.name, columns.status];

  if (columns.identification !== null) {
    recordColumns.push(columns.identification);
  }

  return {
    sheet: sheet,
    headerRow: headerRow,
    lastRow: lastRow,
    lastColumn: lastColumn,
    recordFirstColumn: Math.min.apply(null, recordColumns),
    recordLastColumn: Math.max.apply(null, recordColumns),
    columns: columns,
    headerNames: {
      id: headers[columns.id],
      name: headers[columns.name],
      status: headers[columns.status],
      confirmedAt: headers[columns.confirmedAt],
      identification: columns.identification === null
        ? null
        : headers[columns.identification],
    },
  };
}

function resolveHeaderIndex_(normalizedHeaders, aliases, required) {
  const matches = [];

  normalizedHeaders.forEach(function (header, index) {
    if (aliases.indexOf(header) !== -1) {
      matches.push(index);
    }
  });

  if (matches.length > 1) {
    throw new Error('Há cabeçalhos duplicados para uma coluna reconhecida.');
  }

  if (matches.length === 0) {
    if (required) {
      throw new Error('Um cabeçalho obrigatório não foi encontrado.');
    }
    return null;
  }

  return matches[0];
}

function getScriptSettings_() {
  const properties = PropertiesService.getScriptProperties().getProperties();

  return {
    spreadsheetId: cellText_(properties.SPREADSHEET_ID),
    sheetName: cellText_(properties.SHEET_NAME) || RSVP_CONFIG.defaultSheetName,
    headerRow: parseHeaderRow_(properties.HEADER_ROW),
  };
}

function getSpreadsheet_(spreadsheetId) {
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error(
      'Planilha não encontrada. Vincule o script à planilha ou configure SPREADSHEET_ID.'
    );
  }

  return spreadsheet;
}

function getHeaderRow_() {
  return getScriptSettings_().headerRow;
}

function parseHeaderRow_(value) {
  const text = cellText_(value);
  const row = text ? Number(text) : RSVP_CONFIG.defaultHeaderRow;

  if (!Number.isInteger(row) || row < 1) {
    throw new Error('HEADER_ROW deve ser um número inteiro maior que zero.');
  }

  return row;
}

function normalizeStatus_(value, rowNumber) {
  const normalized = normalizeText_(value);

  if (!normalized || normalized === 'pendente') {
    return RSVP_CONFIG.statuses.pending;
  }
  if (normalized === 'confirmado') {
    return RSVP_CONFIG.statuses.confirmed;
  }
  if (normalized === 'nao vai') {
    return RSVP_CONFIG.statuses.declined;
  }

  throw new Error('Status inválido na linha ' + rowNumber + '.');
}

function normalizeText_(value) {
  return cellText_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader_(value) {
  return normalizeText_(value).replace(/[^a-z0-9]/g, '');
}

function cellText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function getRequestParameter_(e, name) {
  return cellText_(e && e.parameter ? e.parameter[name] : '');
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(error) {
  if (error && error.isApiError) {
    return jsonResponse_({
      success: false,
      error: error.code,
      message: error.publicMessage,
    });
  }

  console.error(error && error.stack ? error.stack : String(error));
  return jsonResponse_({
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'Não conseguimos consultar a lista agora. Tente novamente em alguns instantes.',
  });
}

function ApiError_(code, publicMessage) {
  this.name = 'ApiError';
  this.code = code;
  this.publicMessage = publicMessage;
  this.isApiError = true;
  this.message = publicMessage;
}
