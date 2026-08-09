const path = require('path');
const fs = require('fs');
const { baseDir } = require('./config');

// Fallback icon (16x16 PNG base64) – gerado automaticamente
const ICON_BASE64_FALLBACK =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACy0lEQVR4nJ1TTWgVVxT+zr0z82bmzct7CYltUQhGIUUjtBuhQhe1G6nZVHkBKSIumyYrtSCldFt0oZCoq1Yk0EWC2EUFdWt/FoUKIqKC2tpoo7y+mbw3b37vvcdFEiKalWd1OOd85/8DXpXmvFxTd0w+D3ZPc9/uae7bMfk82CgGAGjdwRILpLc07wz0DWyaUlp+WSpTAQDbErkl+UJHPZhd/GFPG815iYUJvZ5g1TBy5L/9lWptLs69fhtdNHwGAESJQIEqApgQi/bhe9fp6hqG1ipvP/pi3HG9K2FsrD2jHB8/4GUfbLNKALj1qLRnLiv3ZvJ3QJuXlHV36+ePz237Bc15SQAwfCRseBX9rJM63t4xnc593QhfG5FbaS53/vH9YK/ekfXfP0lHvh3f/OsyhQJgqlb0dE833I9GdW8VTKVe308nNWL8ZDwknoxI0aqVdnvMbY33pgEmMXqiFSjNUzZiOn7QTwGg1IAtgaw0FGeGypKp0yOx5a/PzMX+Y7H37xApN/lq9EQrEPWMSGl2Gj7jw5WZiY0hAObHa5m/9Wj4zsUbuT9QZ52VTJ++X8uDWgGt4dQzIoENRK5a85JpOQHlJRMAGAZK1kS8fn2x7DJbkoooIdx6qGwA3O4yASAiwJIA0Qq46oBvP1ZWlBAsScWyyyzunx6MLUmzBQd89ufULRXE/u+ioX3ftDdlBciWADMgCMhKwpkriVcgYCn43P3Tg7EAiHu5nAlklP12TwRfnAobccbUjo1IcqZOd6UD1wH+7yq6+9TyKxxlSS+dAYgFmiz/udQfKWUmAo/Unw+lG8asxoat4uNdTnbykNvVDF5qs676HlVsUkabiSc/DYdosnzjlR2/Nsfk9fuyC89h+A5jKRJIuQaL07DMuocfXXrvlVfegEx+37tTymBSG3Y0AxWLCilxPomWZhcXxtprsW/e7y3o/BI+z3Knq/+b/gAAAABJRU5ErkJggg==';

/**
 * Carrega o melhor ícone disponível (arquivo > base64)
 * Preferência: icon.ico > icon.png > icon-16.png > fallback base64
 */
function carregarIcone() {
  const candidatos = [
    path.join(baseDir, 'assets', 'icon.ico'),
    path.join(baseDir, 'assets', 'icon.png'),
    path.join(baseDir, 'assets', 'icon-16.png'),
    path.join(__dirname, '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(__dirname, '..', 'assets', 'icon-16.png')
  ];

  for (const arquivo of candidatos) {
    if (fs.existsSync(arquivo)) {
      try {
        const buffer = fs.readFileSync(arquivo);
        const base64 = buffer.toString('base64');
        console.log(`✅ Ícone carregado de: ${arquivo}`);
        return base64;
      } catch (e) {
        console.warn(`Não foi possível ler ${arquivo}:`, e.message);
      }
    }
  }

  console.log('ℹ️ Usando ícone embutido (fallback)');
  return ICON_BASE64_FALLBACK;
}

/**
 * Garante o binário do systray2 no disco (necessário para pkg)
 */
function garantirBinarioSystray() {
  const nomeBinario = 'tray_windows_release.exe';
  const isPkg = typeof process.pkg !== 'undefined';
  const pastaExecutavel = isPkg ? path.dirname(process.execPath) : baseDir;
  const caminhoDestino = path.join(pastaExecutavel, nomeBinario);

  if (fs.existsSync(caminhoDestino)) {
    return caminhoDestino;
  }

  const possiveisOrigens = [
    path.join(__dirname, '..', 'node_modules', 'systray2', 'traybin', nomeBinario),
    path.join(baseDir, 'node_modules', 'systray2', 'traybin', nomeBinario),
    path.join(process.cwd(), 'node_modules', 'systray2', 'traybin', nomeBinario)
  ];

  for (const origem of possiveisOrigens) {
    if (fs.existsSync(origem)) {
      try {
        fs.copyFileSync(origem, caminhoDestino);
        console.log(`✅ Binário systray2 copiado para: ${caminhoDestino}`);
        return caminhoDestino;
      } catch (e) {
        console.error(`Erro ao copiar binário: ${e.message}`);
      }
    }
  }

  console.warn('⚠️ Binário do systray2 não encontrado. O tray pode falhar.');
  return null;
}

/**
 * Cria e retorna a instância do system tray com visual melhorado
 */
function criarTray({ config, onSair, onEnviarAgora, onAbrirLogs, onTogglePausa }) {
  const SysTray = require('systray2').default;
  const binPath = garantirBinarioSystray();
  const iconBase64 = carregarIcone();

  let statusAtual = 'Monitorando...';
  let pausado = false;

  // ---- Itens do menu ----
  const itemStatus = {
    title: `● ${statusAtual}`,
    tooltip: 'Status atual do monitoramento',
    checked: false,
    enabled: false
  };

  const itemEnviar = {
    title: '📤  Enviar dados agora',
    tooltip: 'Envia os eventos pendentes para o servidor',
    checked: false,
    enabled: true
  };

  const itemLogs = {
    title: '📂  Abrir pasta de logs',
    tooltip: 'Abre a pasta onde os logs são gravados',
    checked: false,
    enabled: true
  };

  const itemPausa = {
    title: '⏸  Pausar monitoramento',
    tooltip: 'Pausa ou retoma a coleta de dados',
    checked: false,
    enabled: true
  };

  const itemSair = {
    title: '⏻  Sair / Encerrar',
    tooltip: 'Encerra o aplicativo completamente',
    checked: false,
    enabled: true
  };

  // Separador (systray2 aceita title === '<SEPARATOR>')
  const separador = {
    title: '<SEPARATOR>',
    tooltip: '',
    checked: false,
    enabled: false
  };

  const systray = new SysTray({
    menu: {
      icon: iconBase64,
      title: config.tray?.titulo || 'Monitor de Produtividade',
      tooltip: config.tray?.tooltip || 'Monitoramento ativo em segundo plano',
      items: [
        itemStatus,
        separador,
        itemEnviar,
        itemLogs,
        itemPausa,
        separador,
        itemSair
      ]
    },
    debug: false,
    copyDir: true // útil para empacotamento com pkg
  });

  systray.onClick((action) => {
    const titulo = (action.item?.title || '').replace(/^[^\w\s]+\s*/, '').trim(); // remove emoji prefix

    if (titulo.includes('Sair') || titulo.includes('Encerrar')) {
      onSair && onSair();
    } else if (titulo.includes('Enviar')) {
      onEnviarAgora && onEnviarAgora();
    } else if (titulo.includes('logs') || titulo.includes('Abrir')) {
      onAbrirLogs && onAbrirLogs();
    } else if (titulo.includes('Pausar') || titulo.includes('Retomar')) {
      pausado = !pausado;
      itemPausa.title = pausado ? '▶  Retomar monitoramento' : '⏸  Pausar monitoramento';
      onTogglePausa && onTogglePausa(pausado);

      try {
        systray.sendAction({
          type: 'update-item',
          item: { ...itemPausa, seq_id: action.seq_id },
          seq_id: action.seq_id
        });
      } catch (e) {
        // algumas builds do systray2 não suportam bem update
      }

      atualizarStatus(pausado ? 'Pausado' : 'Monitorando...');
    }
  });

  /**
   * Atualiza o texto de status no menu e no tooltip
   */
  function atualizarStatus(texto) {
    statusAtual = texto;

    // Indicador visual por status
    let prefixo = '●';
    if (texto.toLowerCase().includes('ocioso') || texto.toLowerCase().includes('pausa')) {
      prefixo = '○';
    } else if (texto.toLowerCase().includes('pausado')) {
      prefixo = '⏸';
    }

    itemStatus.title = `${prefixo} ${statusAtual}`;

    try {
      systray.sendAction({
        type: 'update-item',
        item: itemStatus,
        seq_id: 0
      });
    } catch (e) {
      // ignore
    }

    console.log(`[TRAY] Status: ${statusAtual} | Pausado: ${pausado}`);
  }

  // Espera o tray ficar pronto
  if (typeof systray.ready === 'function') {
    systray
      .ready()
      .then(() => console.log('✅ System tray pronto com ícone'))
      .catch((err) => console.error('Erro no tray:', err.message));
  }

  return {
    systray,
    atualizarStatus,
    isPausado: () => pausado,
    kill: () => {
      try {
        systray.kill();
      } catch (e) {
        // ignore
      }
    }
  };
}

module.exports = { criarTray, garantirBinarioSystray, carregarIcone };