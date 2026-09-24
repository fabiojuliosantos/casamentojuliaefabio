# Casamento Julia e Fábio

Hotsite para o casamento de Julia e Fábio, em 17 de janeiro de 2027. O projeto contém um frontend estático para GitHub Pages e um backend de RSVP em Google Sheets + Google Apps Script.

## Estado desta fase

- Fonte de dados: a planilha existente; nenhuma planilha nova é criada.
- API: busca por nome e atualização de RSVP em `apps-script/Code.gs`.
- Testes locais: `apps-script/test-local.js`, sem nomes ou dados da lista real.
- Frontend: página responsiva em `index.html`, conectada ao Web App publicado.

## Executar o frontend localmente

O site não exige build nem dependências. Na raiz do projeto, execute:

```bash
python3 -m http.server 4173
```

Depois acesse `http://localhost:4173`. A URL pública do Apps Script fica em `CONFIG.apiUrl`, no início de `app.js`.

A lista de presentes aponta para a página de Julia e Fábio na Ferreira Costa. O botão de localização usa uma busca do Google Maps por `Azura Recepções`; ele também pode ser trocado por um endereço exato quando estiver disponível.

Os nomes e monogramas usam a fonte local `assets/Parfumerie-Script-W00-Regular.ttf`, registrada com `@font-face` no início de `styles.css`. `Parisienne` permanece como fallback caso o arquivo não possa ser carregado.

A guirlanda das iniciais usa `assets/blue-watercolor-wreath.png`, extraída da linguagem botânica do convite de referência com fundo transparente. A citação abaixo da foto usa Cormorant Garamond em itálico para manter a leitura confortável.

## Estrutura real encontrada

A cópia local `planilha.xlsx` foi analisada sem incluir os nomes dos convidados no código ou na documentação:

- uma única aba chamada `Convidados`;
- 140 registros, das linhas 2 a 141;
- todos os IDs estão preenchidos e são únicos;
- todos os registros estão inicialmente como `PENDENTE`;
- `ConfirmadoEm` está vazio em todos os registros;
- 14 nomes possuem espaços externos, que o backend remove durante a leitura;
- existem dois grupos de nomes duplicados após normalização, envolvendo quatro linhas;
- não existe atualmente uma coluna `Identificação`.

| Coluna | Cabeçalho real | Uso |
| --- | --- | --- |
| A | `ID` | Identificador interno estável. |
| B | `Nome` | Nome do convidado. |
| C | `Status` | `PENDENTE`, `CONFIRMADO` ou `NÃO VAI`. |
| D | `ConfirmadoEm` | Data e hora da resposta mais recente. |
| E–G | vazias | Separação visual. |
| H | `TotalPendentes` | Fórmula `COUNTIF` de resumo. |
| I | `TotalConfirmados` | Fórmula `COUNTIF` de resumo. |
| J | `TotalNaoIrao` | Fórmula `COUNTIF` de resumo. |

O prompt previa aproximadamente uma coluna `Presença`; a coluna real se chama `Status`. O backend foi adaptado para `Status` e mantém `Presença` como alias compatível. As colunas de totais são ignoradas e preservadas.

Uma coluna opcional `Identificação` pode ser adicionada para diferenciar somente os quatro registros homônimos. Sem ela, a API continua funcionando, mas os botões desses homônimos terão o mesmo texto. A planilha não foi alterada automaticamente.

O arquivo `planilha.xlsx` está no `.gitignore` por conter dados privados e não deve ser publicado no GitHub Pages.

## Configurar o Google Apps Script

A opção recomendada é vincular o script diretamente à planilha oficial:

1. Abra a planilha oficial no Google Sheets.
2. Acesse **Extensões > Apps Script**.
3. No editor, abra `Code.gs` e substitua o conteúdo pelo arquivo [`apps-script/Code.gs`](apps-script/Code.gs).
4. Salve o projeto.
5. Em **Configurações do projeto > Propriedades do script**, adicione somente o que for necessário:
   - `SHEET_NAME`: somente se a aba for renomeada; o padrão já é `Convidados`;
   - `HEADER_ROW`: número da linha de cabeçalho, apenas se não for `1`.
6. Se optar por um projeto Apps Script independente, adicione também `SPREADSHEET_ID` com o ID da planilha. Essa propriedade não vai para o JavaScript do site.

O projeto vinculado não precisa de `SPREADSHEET_ID`: ele usa a própria planilha ativa. Não há credenciais, chaves ou segredos no frontend.

## Inspecionar e validar sem expor convidados

No seletor de funções do editor Apps Script:

1. Execute `inspectSheetStructure`.
2. Autorize o acesso à planilha quando o Google solicitar.
3. Consulte o **Registro de execução**. A função retorna nome das abas, cabeçalhos e quantidade de linhas, mas nenhum nome ou ID de convidado.
4. Confirme que a aba retornada é `Convidados` e que os cabeçalhos operacionais são `ID`, `Nome`, `Status` e `ConfirmadoEm`.
5. Execute `validateConfiguration`.

`validateConfiguration` confirma a aba escolhida, os nomes reais dos cabeçalhos, a quantidade de convidados, os grupos de nomes duplicados e quantos homônimos ainda estão sem `Identificação`. Ela também falha se houver ID vazio/duplicado ou status desconhecido.

## Publicar como Web App

1. No editor Apps Script, clique em **Implantar > Nova implantação**.
2. Em **Selecionar tipo**, escolha **App da Web**.
3. Em **Executar como**, escolha **Eu** (proprietário da planilha).
4. Em **Quem pode acessar**, escolha a opção que permita acesso público sem login. O texto exato varia entre contas pessoais e Google Workspace.
5. Clique em **Implantar** e conclua a autorização.
6. Copie a URL terminada em `/exec`. Não use a URL `/dev` no site; ela é apenas para editores e testes do código mais recente.

Após qualquer mudança futura no código, crie uma nova versão da implantação para que `/exec` use a versão atualizada.

## Testar a API publicada

Defina a URL somente no seu terminal:

```bash
API_URL='COLE_AQUI_A_URL_TERMINADA_EM_EXEC'
```

O Google redireciona respostas do `ContentService` para uma URL temporária em `script.googleusercontent.com`; por isso os exemplos usam `curl -L`.

### 1. Saúde e configuração

```bash
curl -L -sS "$API_URL?action=health"
```

Resposta esperada:

```json
{"success":true,"status":"ok"}
```

### 2. Busca com acento, sem acento e parcial

```bash
curl -L -sS --get "$API_URL" --data-urlencode 'action=search' --data-urlencode 'q=José'
curl -L -sS --get "$API_URL" --data-urlencode 'action=search' --data-urlencode 'q=jose'
curl -L -sS --get "$API_URL" --data-urlencode 'action=search' --data-urlencode 'q=maria'
```

A resposta contém no máximo 10 resultados e somente `id`, `name`, `status` e, quando necessário, `identification`.

### 3. Resultado vazio

```bash
curl -L -sS --get "$API_URL" --data-urlencode 'action=search' --data-urlencode 'q=nomeinexistente'
```

Resposta esperada:

```json
{"success":true,"results":[]}
```

### 4. Confirmar, recusar e alterar

Use um ID retornado pela busca. Faça o primeiro teste com uma linha de teste controlada na planilha, pois estas chamadas escrevem na fonte oficial.

```bash
curl -L -sS "$API_URL" \
  -H 'Content-Type: text/plain;charset=UTF-8' \
  --data '{"action":"rsvp","id":"ID_DE_TESTE","attending":true}'

curl -L -sS "$API_URL" \
  -H 'Content-Type: text/plain;charset=UTF-8' \
  --data '{"action":"rsvp","id":"ID_DE_TESTE","attending":false}'
```

Repita a confirmação com `true` para validar a alteração posterior. Em cada chamada, confira na planilha se `Status` e `ConfirmadoEm` foram atualizados.

### 5. ID inválido

```bash
curl -L -sS "$API_URL" \
  -H 'Content-Type: text/plain;charset=UTF-8' \
  --data '{"action":"rsvp","id":"ID-QUE-NAO-EXISTE","attending":true}'
```

Resposta esperada:

```json
{"success":false,"error":"GUEST_NOT_FOUND","message":"Convidado não encontrado."}
```

## Estratégia para GitHub Pages, CORS e redirects

O Apps Script expõe `doGet` e `doPost`, mas não oferece um manipulador `OPTIONS` para este caso. Para evitar o preflight CORS no navegador, o frontend enviará o RSVP como uma requisição simples:

```js
fetch(API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  body: JSON.stringify({ action: 'rsvp', id, attending }),
});
```

Não usar `application/json` nem cabeçalhos personalizados: eles provocariam preflight. O `fetch` segue redirects por padrão, o que é necessário porque o `ContentService` entrega a resposta final por `script.googleusercontent.com`.

O Apps Script não permite controlar livremente status HTTP e cabeçalhos no `TextOutput`. Por isso a aplicação deve interpretar `success` e `error` no JSON, e nunca mostrar mensagens técnicas ao convidado. A compatibilidade real com a origem do GitHub Pages deverá ser validada no navegador depois da implantação e antes de conectar o frontend.

## Desempenho da API

O Apps Script e o redirecionamento do `ContentService` acrescentam latência que não pode ser eliminada pelo projeto. Para reduzir as chamadas à planilha, o backend mantém o índice de busca no `CacheService` por até cinco minutos. O endpoint de saúde também aquece esse cache, e cada RSVP atualiza nele o status correspondente.

A primeira busca após o cache expirar ainda precisa ler e validar a planilha. As buscas seguintes evitam essa leitura enquanto o Google mantiver o item em cache. Alterações manuais na planilha podem levar até cinco minutos para aparecer na busca; alterações feitas pela própria API são refletidas imediatamente.

Na gravação, `Status` e `ConfirmadoEm` são atualizados juntos quando as colunas estão adjacentes, como na estrutura oficial. Isso reduz as operações remotas sem remover o lock ou as validações de segurança.

Nos testes via `curl`, não use `-X POST`: `--data` já seleciona POST na primeira chamada, e o `curl -L` precisa converter o redirecionamento do Google em GET para receber o JSON final.

## Testes locais

Os testes usam apenas Node.js nativo e uma planilha em memória:

```bash
node apps-script/test-local.js
```

Eles cobrem:

- busca com e sem acento;
- busca parcial e por múltiplos termos (`JOAO SILVA` encontra `João da Silva`);
- reutilização e sincronização do cache de busca;
- resultado vazio e múltiplos resultados;
- identificação apenas para homônimos;
- leitura de `CONFIRMADO` e `NÃO VAI`;
- confirmação, recusa e alteração posterior;
- ID inexistente;
- mensagem segura em falha de conexão;
- aquisição/liberação do lock e contenção concorrente;
- mínimo de 3 caracteres e máximo de 10 resultados.

O teste local verifica a lógica, mas não substitui o teste do Web App implantado, especialmente redirects, permissões e execução a partir do GitHub Pages.

## Segurança e privacidade

- Não existe endpoint para baixar ou listar todos os convidados.
- A busca exige 3 caracteres e retorna no máximo 10 itens.
- O POST aceita somente `action`, `id` e `attending` e nunca recebe coluna ou número de linha.
- O convidado é localizado novamente pelo ID estável dentro do lock antes de gravar.
- `LockService.getScriptLock()` serializa as gravações concorrentes.
- Erros internos são registrados no Apps Script, mas a API retorna mensagem genérica.
- A cópia `planilha.xlsx` permanece apenas local e é ignorada pelo Git.
- Nenhum nome ou ID real foi copiado para o código, testes ou documentação.

## Referência visual para a próxima fase

O arquivo `.referencia/ref.jpeg` é a fonte visual oficial. A leitura feita nesta fase identificou:

- fundo azul-gelo quase uniforme e muito espaço negativo;
- texto principal em azul-marinho, com contraste delicado;
- monograma `J F` caligráfico dentro de uma guirlanda assimétrica;
- aquarela botânica em azul médio, royal e profundo, folhagem azul-acinzentada e pequenos acentos ocres;
- nomes em caligrafia de alto contraste; data e horário em serifada clássica;
- fotografia vertical com topo em arco, tratada como aquarela e integrada ao fundo;
- composição horizontal dividida: identidade e ações à esquerda; fotografia e mensagem à direita;
- três ações circulares em ocre, com ícones brancos simples e rótulos abaixo.

Uma extração de cores da própria imagem sugere esta base para o CSS futuro: fundo `#EAF3FA`, azul-marinho `#273247`, azul royal `#305CB6`, azul suave `#708BB5`, ocre `#B78333` e bege rosado `#D4C3AA`. Esses valores ainda devem ser avaliados no contexto dos elementos e do contraste, pois a aquarela produz muitas variações tonais.

Esses elementos devem orientar o frontend mobile-first depois que a API estiver validada. Julia permanece sem acento em todo o projeto.
