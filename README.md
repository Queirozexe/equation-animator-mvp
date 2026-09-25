# Equation Animator — MVP

Aplicação estática mobile-first para digitar uma equação `y = f(x)`, animar o desenho e compartilhar a própria equação pela URL.

## Funcionalidades implementadas

- Campo único para inserir a equação.
- Sem equações de exemplo carregadas na interface.
- Correções automáticas simples de escrita:
  - `π` → `pi`
  - `×` / `·` → `*`
  - `÷` → `/`
  - `sen(` → `sin(`
  - `tg(` → `tan(`
  - vírgula decimal entre números → ponto
  - `y = ...` e `f(x) = ...` são aceitos.
- Mensagens de erro para parênteses, símbolos desconhecidos e sintaxe inválida.
- Gráfico animado em Canvas 2D.
- Layout otimizado para smartphone em orientação vertical.
- Compartilhamento via URL usando `?eq=`.
- Ao abrir um link com `?eq=...`, a equação é carregada e animada automaticamente.
- Web Share API em celulares compatíveis, com fallback para copiar o link.

## Executar

Abra `index.html` em um servidor web simples. Para produção, publique os três arquivos em GitHub Pages, Netlify, Vercel ou serviço equivalente.

> A biblioteca Math.js é carregada por CDN no `index.html`.
