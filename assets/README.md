# Assets – Ícones do Tray

## Arquivos gerados

| Arquivo       | Uso                          |
|---------------|------------------------------|
| `icon.ico`    | Preferido no Windows (multi-size) |
| `icon.png`    | 32×32 PNG                    |
| `icon-16.png` | 16×16 PNG (usado no fallback)|

O `src/tray.js` tenta carregar nesta ordem:

1. `assets/icon.ico`
2. `assets/icon.png`
3. `assets/icon-16.png`
4. Base64 embutido (fallback)

## Substituir o ícone

Para usar seu próprio ícone:

1. Coloque um arquivo `icon.ico` ou `icon.png` nesta pasta.
2. Reinicie o aplicativo.

**Recomendações para Windows tray:**
- Tamanhos: 16×16 e 32×32
- Formato: `.ico` (melhor) ou PNG com transparência
- Fundo transparente ou círculo sólido
- Cores contrastantes (visível em tema claro e escuro)