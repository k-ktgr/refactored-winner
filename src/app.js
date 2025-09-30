(() => {
  const htmlEditor = document.getElementById('editor-html');
  const frame = document.getElementById('preview-frame');
  const errorsEl = document.getElementById('errors');

  const btnCopy = document.getElementById('btn-copy');
  const btnSave = document.getElementById('btn-save');
  const btnReset = document.getElementById('btn-reset');
  const btnTheme = document.getElementById('btn-theme');
  const btnPreviewFullscreen = document.getElementById('btn-preview-fullscreen');
  const btnExportPng = document.getElementById('btn-export-png');
  const btnExportPdf = document.getElementById('btn-export-pdf');
  const previewContainer = document.getElementById('preview');
  const btnEditorPaste = document.getElementById('btn-editor-paste');
  const btnEditorReset = document.getElementById('btn-editor-reset');

  const STORAGE_KEYS = { html: 'gcr:fullhtml' };

  function wrapForErrorsIfNeeded(fullHtml) {
    // iframe内でのエラーを親へ伝搬させるため、</body>直前にtry-catchを注入
    if (!fullHtml) return '';
    const catcher = `<script>window.addEventListener('error',e=>{parent.postMessage({__gcr_error:String(e.error||e.message)},'*')});` +
      `window.addEventListener('unhandledrejection',e=>{parent.postMessage({__gcr_error:String(e.reason)},'*')});</` + `script>`;
    if (fullHtml.includes('</body>')) {
      return fullHtml.replace('</body>', `${catcher}</body>`);
    }
    return fullHtml + catcher;
  }

  function render() {
    const doc = wrapForErrorsIfNeeded(htmlEditor.value);
    errorsEl.hidden = true;
    errorsEl.textContent = '';
    frame.srcdoc = doc;
    frame.dataset.external = '0';
  }

  // debounce
  let timer = 0;
  function scheduleRender() {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, 150);
  }

  // autosave
  function saveToStorage() { localStorage.setItem(STORAGE_KEYS.html, htmlEditor.value); }
  function loadFromStorage() {
    const sample = '<!DOCTYPE html>\n<html lang="ja">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>Sample</title>\n  <style>body{font:16px/1.6 system-ui;padding:24px}h1{color:#4f8cff}</style>\n</head>\n<body>\n  <h1>Hello, Gemini Canvas!</h1>\n  <p>左にフルHTMLを貼り付けてください。</p>\n  <script>console.log("Ready")</' + 'script>\n</body>\n</html>';
    htmlEditor.value = localStorage.getItem(STORAGE_KEYS.html) || sample;
  }

  function handleInput() {
    scheduleRender();
    saveToStorage();
  }

  // buttons
  async function copyCombinedHtml() {
    const text = htmlEditor.value;
    await navigator.clipboard.writeText(text);
    btnCopy.textContent = 'コピー済み';
    setTimeout(() => (btnCopy.textContent = 'コピーHTML'), 1200);
  }

  function download(filename, content) {
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function saveAsFile() {
    const text = htmlEditor.value;
    download('export.html', text);
  }
  function resetAll() {
    if (!confirm('エディタ内容とローカル保存をクリアします。よろしいですか？')) return;
    localStorage.removeItem(STORAGE_KEYS.html);
    localStorage.removeItem(STORAGE_KEYS.css);
    localStorage.removeItem(STORAGE_KEYS.js);
    loadFromStorage();
    render();
  }
  function togglePreviewFullscreen() {
    const el = previewContainer;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  async function withPreviewFullscreen(captureFn) {
    let entered = false;
    if (!document.fullscreenElement) {
      await previewContainer.requestFullscreen?.();
      entered = true;
      await new Promise((resolve) => {
        const handler = () => { document.removeEventListener('fullscreenchange', handler); resolve(); };
        document.addEventListener('fullscreenchange', handler);
        // フォールバック: 200ms待機
        setTimeout(() => { document.removeEventListener('fullscreenchange', handler); resolve(); }, 200);
      });
    }
    // レイアウト安定待ち
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      return await captureFn();
    } finally {
      if (entered && document.fullscreenElement) {
        await document.exitFullscreen?.();
      }
    }
  }

  async function exportPng() {
    await withPreviewFullscreen(async () => {
      const doc = frame.contentDocument;
      if (!doc) { alert('プレビューが読み込まれていません'); return; }
      const root = doc.documentElement;
      const width = Math.max(root.scrollWidth, root.clientWidth);
      const height = Math.max(root.scrollHeight, root.clientHeight);
      const canvas = await html2canvas(root, {
        backgroundColor: '#ffffff',
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        scale: 2
      });
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'preview.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  async function exportPdf() {
    await withPreviewFullscreen(async () => {
      const doc = frame.contentDocument;
      if (!doc) { alert('プレビューが読み込まれていません'); return; }
      const root = doc.documentElement;
      const width = Math.max(root.scrollWidth, root.clientWidth);
      const height = Math.max(root.scrollHeight, root.clientHeight);
      const canvas = await html2canvas(root, {
        backgroundColor: '#ffffff',
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        scale: 2
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
      pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
      pdf.save('preview.pdf');
    });
  }

  // error relay from iframe
  window.addEventListener('message', (ev) => {
    const data = ev?.data;
    if (data && data.__gcr_error) {
      errorsEl.hidden = false;
      errorsEl.textContent = String(data.__gcr_error);
    }
  });

  // init
  loadFromStorage();
  render();

  htmlEditor.addEventListener('input', handleInput);

  btnCopy.addEventListener('click', () => { copyCombinedHtml().catch(() => {}); });
  btnSave.addEventListener('click', saveAsFile);
  btnReset.addEventListener('click', resetAll);
  btnPreviewFullscreen.addEventListener('click', togglePreviewFullscreen);
  btnExportPng.addEventListener('click', () => { exportPng().catch(() => {}); });
  btnExportPdf.addEventListener('click', () => { exportPdf().catch(() => {}); });
  btnEditorReset.addEventListener('click', () => {
    if (!confirm('このエディタだけを初期内容に戻します。よろしいですか？')) return;
    localStorage.removeItem(STORAGE_KEYS.html);
    loadFromStorage();
    render();
  });
  btnEditorPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      htmlEditor.value = text;
      saveToStorage();
      render();
    } catch {
      alert('クリップボードから読み取れませんでした。ブラウザの許可設定をご確認ください。');
    }
  });

  // theme toggle
  const THEME_KEY = 'gcr:theme';
  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
  function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
  }
  loadTheme();
  btnTheme.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });
})();


