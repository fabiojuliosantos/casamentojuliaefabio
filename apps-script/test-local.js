import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');
const exportedFunctions = [
  'doGet',
  'doPost',
  'getGuestRecords_',
  'getSearchRecordsFromCache_',
  'parseRsvpPayload_',
  'searchGuests_',
  'updateRsvp_',
  'validateConfiguration',
];

function defaultRows() {
  return [
    ['ID', 'Nome', 'Status', 'ConfirmadoEm', 'Identificação', '', '', 'TotalPendentes', 'TotalConfirmados', 'TotalNaoIrao'],
    ['1', 'José Silva', 'PENDENTE', '', 'Família A', '', '', '', '', ''],
    ['2', 'Maria Souza', 'CONFIRMADO', '', '', '', '', '', '', ''],
    ['3', 'João da Silva', '', '', '', '', '', '', '', ''],
    ['4', 'José Silva', 'NÃO VAI', '', 'Família B', '', '', '', '', ''],
  ];
}

function createHarness(options = {}) {
  const rows = structuredClone(options.rows || defaultRows());
  const cacheValues = new Map();
  const metrics = {
    cacheGets: 0,
    cachePuts: 0,
    cacheRemoves: 0,
    dataRangeCalls: 0,
    displayReads: [],
    displayCellReads: 0,
    flushes: 0,
    getProperties: 0,
    getProperty: 0,
    getSheetByName: 0,
    lockAttempts: 0,
    lockReleases: 0,
    openSpreadsheet: 0,
    setValues: [],
    setValue: [],
    valueReads: 0,
  };

  function lastUsedRow() {
    for (let row = rows.length - 1; row >= 0; row -= 1) {
      if (rows[row].some((value) => value !== '' && value !== null && value !== undefined)) {
        return row + 1;
      }
    }
    return 1;
  }

  function lastUsedColumn() {
    let result = 1;
    rows.forEach((row) => {
      for (let column = row.length - 1; column >= 0; column -= 1) {
        if (row[column] !== '' && row[column] !== null && row[column] !== undefined) {
          result = Math.max(result, column + 1);
          break;
        }
      }
    });
    return result;
  }

  class FakeRange {
    constructor(row, column, numRows = 1, numColumns = 1) {
      this.row = row;
      this.column = column;
      this.numRows = numRows;
      this.numColumns = numColumns;
    }

    getLastColumn() {
      return this.column + this.numColumns - 1;
    }

    getLastRow() {
      return this.row + this.numRows - 1;
    }

    getDisplayValues() {
      metrics.displayReads.push({
        row: this.row,
        column: this.column,
        numRows: this.numRows,
        numColumns: this.numColumns,
      });
      return Array.from({ length: this.numRows }, (_, rowOffset) =>
        Array.from({ length: this.numColumns }, (_, columnOffset) => {
          const value = rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset];
          return value === null || value === undefined ? '' : String(value);
        })
      );
    }

    getDisplayValue() {
      metrics.displayCellReads += 1;
      const value = rows[this.row - 1]?.[this.column - 1];
      return value === null || value === undefined ? '' : String(value);
    }

    getValues() {
      metrics.valueReads += 1;
      return Array.from({ length: this.numRows }, (_, rowOffset) =>
        Array.from({ length: this.numColumns }, (_, columnOffset) =>
          rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset]
        )
      );
    }

    getValue() {
      metrics.valueReads += 1;
      return rows[this.row - 1]?.[this.column - 1];
    }

    setValues(values) {
      metrics.setValues.push({
        row: this.row,
        column: this.column,
        numRows: this.numRows,
        numColumns: this.numColumns,
        values,
      });
      values.forEach((valueRow, rowOffset) => {
        valueRow.forEach((value, columnOffset) => {
          rows[this.row - 1 + rowOffset][this.column - 1 + columnOffset] = value;
        });
      });
      return this;
    }

    setValue(value) {
      metrics.setValue.push({ row: this.row, column: this.column, value });
      rows[this.row - 1][this.column - 1] = value;
      return this;
    }
  }

  const sheet = {
    getDataRange() {
      metrics.dataRangeCalls += 1;
      return new FakeRange(1, 1, lastUsedRow(), lastUsedColumn());
    },
    getName() {
      return 'Convidados';
    },
    getRange(row, column, numRows, numColumns) {
      return new FakeRange(row, column, numRows, numColumns);
    },
  };

  const spreadsheet = {
    getSheetByName(name) {
      metrics.getSheetByName += 1;
      return name === 'Convidados' ? sheet : null;
    },
    getSheets() {
      return [sheet];
    },
  };

  const cache = {
    get(key) {
      metrics.cacheGets += 1;
      return cacheValues.get(key) ?? null;
    },
    put(key, value) {
      metrics.cachePuts += 1;
      cacheValues.set(key, value);
    },
    remove(key) {
      metrics.cacheRemoves += 1;
      cacheValues.delete(key);
    },
  };

  const lock = {
    tryLock() {
      metrics.lockAttempts += 1;
      return options.lockAvailable !== false;
    },
    releaseLock() {
      metrics.lockReleases += 1;
    },
  };

  const properties = {
    ...(options.properties || {}),
  };
  const sandbox = {
    CacheService: {
      getScriptCache() {
        return cache;
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return {
          text,
          setMimeType() {
            return this;
          },
        };
      },
    },
    Date,
    JSON,
    LockService: {
      getScriptLock() {
        return lock;
      },
    },
    Number,
    Object,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperties() {
            metrics.getProperties += 1;
            return { ...properties };
          },
          getProperty(name) {
            metrics.getProperty += 1;
            return properties[name] ?? null;
          },
        };
      },
    },
    SpreadsheetApp: {
      flush() {
        metrics.flushes += 1;
      },
      getActiveSpreadsheet() {
        metrics.openSpreadsheet += 1;
        return options.spreadsheetUnavailable ? null : spreadsheet;
      },
      openById() {
        metrics.openSpreadsheet += 1;
        return options.spreadsheetUnavailable ? null : spreadsheet;
      },
    },
    String,
    console: {
      error() {},
      log() {},
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(
    source + '\n;globalThis.__api = {' + exportedFunctions.join(',') + '};',
    context,
    { filename: 'Code.gs' }
  );

  return {
    api: context.__api,
    cacheValues,
    metrics,
    rows,
    resetMetrics() {
      Object.keys(metrics).forEach((key) => {
        metrics[key] = Array.isArray(metrics[key]) ? [] : 0;
      });
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('busca fria normaliza acentos, limita a leitura e aquece o cache', () => {
  const harness = createHarness();
  const results = plain(harness.api.searchGuests_('jose'));

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.identification), ['Família A', 'Família B']);
  assert.equal(harness.metrics.getProperties, 1);
  assert.equal(harness.metrics.getProperty, 0);
  assert.equal(harness.metrics.cachePuts, 1);

  const dataRead = harness.metrics.displayReads.find((range) => range.row === 2);
  assert.deepEqual(dataRead, {
    row: 2,
    column: 1,
    numRows: 4,
    numColumns: 5,
  });
});

test('busca quente usa somente o cache e aceita múltiplos termos', () => {
  const harness = createHarness();
  harness.api.searchGuests_('maria');
  harness.resetMetrics();

  const results = plain(harness.api.searchGuests_('joao silva'));

  assert.deepEqual(results.map((item) => item.name), ['João da Silva']);
  assert.equal(harness.metrics.cacheGets, 1);
  assert.equal(harness.metrics.getProperties, 0);
  assert.equal(harness.metrics.dataRangeCalls, 0);
  assert.deepEqual(harness.metrics.displayReads, []);
});

test('RSVP quente verifica apenas o ID da linha e grava status/data em lote', () => {
  const harness = createHarness();
  harness.api.searchGuests_('jose');
  harness.resetMetrics();

  const result = plain(harness.api.updateRsvp_('1', true));

  assert.deepEqual(result, { success: true, id: '1', status: 'CONFIRMADO' });
  assert.equal(harness.metrics.displayCellReads, 1);
  assert.equal(harness.metrics.valueReads, 0);
  assert.equal(harness.metrics.setValues.length, 1);
  assert.deepEqual(
    {
      row: harness.metrics.setValues[0].row,
      column: harness.metrics.setValues[0].column,
      numColumns: harness.metrics.setValues[0].numColumns,
    },
    { row: 2, column: 3, numColumns: 2 }
  );
  assert.equal(harness.rows[1][2], 'CONFIRMADO');
  assert.ok(harness.rows[1][3] instanceof Date);
  assert.equal(harness.metrics.flushes, 1);
  assert.equal(harness.metrics.lockReleases, 1);
  assert.equal(harness.metrics.cacheGets, 1);
  assert.equal(harness.metrics.cachePuts, 1);

  const cachedRecords = JSON.parse(
    harness.cacheValues.get('guest-search-v2')
  );
  assert.equal(cachedRecords.find((record) => record.id === '1').status, 'CONFIRMADO');

  const dataReads = harness.metrics.displayReads.filter((range) => range.row > 1);
  assert.deepEqual(dataReads, []);
});

test('linha movida invalida o atalho e força releitura segura', () => {
  const harness = createHarness();
  harness.api.searchGuests_('jose');
  [harness.rows[1], harness.rows[2]] = [harness.rows[2], harness.rows[1]];
  harness.resetMetrics();

  const result = plain(harness.api.updateRsvp_('1', false));

  assert.equal(result.status, 'NÃO VAI');
  assert.equal(harness.rows[2][2], 'NÃO VAI');
  assert.equal(harness.metrics.displayCellReads, 1);
  assert.ok(harness.metrics.displayReads.some((range) => range.row === 2));

  const cachedRecords = JSON.parse(
    harness.cacheValues.get('guest-search-v2')
  );
  assert.equal(cachedRecords.find((record) => record.id === '1').rowNumber, 3);
});

test('cache inválido é descartado sem derrubar a busca', () => {
  const harness = createHarness();
  harness.cacheValues.set('guest-search-v2', JSON.stringify([{ id: '1' }]));

  const results = plain(harness.api.searchGuests_('maria'));

  assert.equal(results[0].name, 'Maria Souza');
  assert.equal(harness.metrics.cacheRemoves, 1);
  assert.equal(harness.metrics.cachePuts, 1);
});

test('busca vazia, limites e status conhecidos são preservados', () => {
  const rows = [
    defaultRows()[0],
    ...Array.from({ length: 12 }, (_, index) => [
      String(index + 1),
      'Maria Convidada ' + String(index + 1),
      index === 0 ? 'CONFIRMADO' : index === 1 ? 'NÃO VAI' : 'PENDENTE',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]),
  ];
  const harness = createHarness({ rows });

  const results = plain(harness.api.searchGuests_('maria'));
  assert.equal(results.length, 10);
  assert.equal(results[0].status, 'CONFIRMADO');
  assert.equal(results[1].status, 'PENDENTE');
  assert.deepEqual(plain(harness.api.searchGuests_('inexistente')), []);

  assert.throws(
    () => harness.api.searchGuests_('ab'),
    (error) => error.code === 'QUERY_TOO_SHORT'
  );
  assert.throws(
    () => harness.api.searchGuests_('a'.repeat(81)),
    (error) => error.code === 'QUERY_TOO_LONG'
  );
});

test('resposta pode ser recusada e alterada posteriormente', () => {
  const harness = createHarness();
  harness.api.searchGuests_('maria');

  assert.equal(harness.api.updateRsvp_('2', false).status, 'NÃO VAI');
  assert.equal(harness.api.updateRsvp_('2', true).status, 'CONFIRMADO');
  assert.equal(harness.rows[2][2], 'CONFIRMADO');
});

test('ID inexistente não grava e sempre libera o lock', () => {
  const harness = createHarness();

  assert.throws(
    () => harness.api.updateRsvp_('inexistente', true),
    (error) => error.code === 'GUEST_NOT_FOUND'
  );
  assert.equal(harness.metrics.setValues.length, 0);
  assert.equal(harness.metrics.lockReleases, 1);
});

test('lock ocupado retorna BUSY sem acessar a planilha', () => {
  const harness = createHarness({ lockAvailable: false });

  assert.throws(
    () => harness.api.updateRsvp_('1', true),
    (error) => error.code === 'BUSY'
  );
  assert.equal(harness.metrics.getProperties, 0);
  assert.equal(harness.metrics.openSpreadsheet, 0);
  assert.equal(harness.metrics.lockReleases, 0);
});

test('payload aceita apenas id, attending e action opcional', () => {
  const harness = createHarness();
  const parsed = plain(harness.api.parseRsvpPayload_({
    postData: { contents: JSON.stringify({ id: ' 1 ', attending: true }) },
  }));

  assert.deepEqual(parsed, { id: '1', attending: true });
  assert.throws(
    () => harness.api.parseRsvpPayload_({
      postData: { contents: JSON.stringify({ id: '1', attending: true, row: 2 }) },
    }),
    (error) => error.code === 'INVALID_PAYLOAD'
  );
});

test('validação não expõe nomes e conta grupos homônimos', () => {
  const harness = createHarness();
  const result = plain(harness.api.validateConfiguration());

  assert.equal(result.guestCount, 4);
  assert.equal(result.duplicateNameGroups, 1);
  assert.equal(result.duplicateRowsWithoutIdentification, 0);
  assert.equal(JSON.stringify(result).includes('José'), false);
});

test('doPost converte erros inesperados em resposta pública segura', () => {
  const harness = createHarness();
  const response = harness.api.doPost({
    postData: { contents: '{' },
  });
  const payload = JSON.parse(response.text);

  assert.deepEqual(payload, {
    success: false,
    error: 'INVALID_JSON',
    message: 'Não foi possível ler sua resposta.',
  });
});

test('falha de conexão com a planilha retorna mensagem genérica', () => {
  const harness = createHarness({ spreadsheetUnavailable: true });
  const response = harness.api.doGet({
    parameter: { action: 'search', q: 'maria' },
  });
  const payload = JSON.parse(response.text);

  assert.deepEqual(payload, {
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'Não conseguimos consultar a lista agora. Tente novamente em alguns instantes.',
  });
});
