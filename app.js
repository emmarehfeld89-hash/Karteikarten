(() => {
  const STORAGE_KEY = 'karteikarten-app-v1';
  const INTERVALS = { poor: 10 * 60 * 1000, hard: 24 * 60 * 60 * 1000, normal: 3 * 24 * 60 * 60 * 1000, easy: 7 * 24 * 60 * 60 * 1000 };
  const RATING_NAMES = { poor: 'Schlecht', hard: 'Schwierig', normal: 'Normal', easy: 'Leicht' };
  const EMOJIS = ['📁', '📚', '🌿', '🔬', '✨', '🧠', '🌍', '🎨'];
  const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'H3', 'UL', 'OL', 'LI']);
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    folderNav: $('#folder-nav'), folderCards: $('#folder-cards'), cardsArea: $('#cards-area'), emptyState: $('#empty-state'),
    dateLabel: $('#date-label'), currentFolder: $('#current-folder-name'), pageTitle: $('#page-title'), pageSubtitle: $('#page-subtitle'),
    listTitle: $('#list-title'), listDescription: $('#list-description'), dueCount: $('#due-count'), dueFoot: $('#due-foot'),
    totalCount: $('#total-count'), folderCount: $('#folder-count'), syncLabel: $('#sync-label'), toast: $('#toast'),
    folderDialog: $('#folder-dialog'), cardDialog: $('#card-dialog'), studyDialog: $('#study-dialog'),
    folderForm: $('#folder-form'), cardForm: $('#card-form'), folderName: $('#folder-name'), folderParent: $('#folder-parent'),
    cardFolder: $('#card-folder'), front: $('#card-front'), back: $('#card-back'), emptyTitle: $('#empty-title'),
    emptyDescription: $('#empty-description'), emptyAction: $('#empty-action'), learnCurrent: $('#learn-current'),
    studyProgress: $('#study-progress'), studyFolder: $('#study-folder'), studySide: $('#study-side'),
    studyContent: $('#study-content'), studyHint: $('#study-hint'), flip: $('#flip-card'), ratingArea: $('#rating-area')
  };
  let toastTimer;

  function loadData() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return { folders: [], cards: [] };
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed.folders) || !Array.isArray(parsed.cards)) throw new Error('Ungültiges Datenformat.');
      const folders = normalizeFolders(parsed.folders);
      const folderIds = new Set(folders.map((folder) => folder.id));
      const cards = parsed.cards.filter((card) => card && typeof card.id === 'string' && folderIds.has(card.folderId))
        .map((card) => ({ ...card, front: sanitizeHtml(card.front || ''), back: sanitizeHtml(card.back || '') }));
      return { folders, cards };
    } catch (error) {
      console.error('Die gespeicherten Karteikarten konnten nicht geladen werden.', error);
      showToast('Gespeicherte Daten konnten nicht geladen werden.');
      return { folders: [], cards: [] };
    }
  }

  let data = loadData();
  let selectedFolderId = null;
  let studyQueue = [];
  let studyIndex = 0;
  let showingAnswer = false;

  function normalizeFolders(input) {
    const folders = input.filter((folder) => folder && typeof folder.id === 'string' && typeof folder.name === 'string')
      .map((folder) => ({ ...folder, parentId: typeof folder.parentId === 'string' ? folder.parentId : null }));
    const ids = new Set(folders.map((folder) => folder.id));
    folders.forEach((folder) => {
      if (!ids.has(folder.parentId) || folder.parentId === folder.id) folder.parentId = null;
      const visited = new Set([folder.id]);
      let parent = folder.parentId ? folders.find((item) => item.id === folder.parentId) : null;
      while (parent) {
        if (visited.has(parent.id)) {
          folder.parentId = null;
          break;
        }
        visited.add(parent.id);
        parent = parent.parentId ? folders.find((item) => item.id === parent.parentId) : null;
      }
    });
    return folders;
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      elements.syncLabel.textContent = '● Lokal gespeichert';
    } catch (error) {
      console.error('Die Karteikarten konnten nicht gespeichert werden.', error);
      elements.syncLabel.textContent = '● Speicherfehler';
      showToast('Speichern fehlgeschlagen. Prüfe den verfügbaren Gerätespeicher.');
    }
  }

  function id() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function sanitizeHtml(html) {
    const parsed = new DOMParser().parseFromString(String(html), 'text/html');
    const cleanNode = (node) => {
      const fragment = document.createDocumentFragment();
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          fragment.append(document.createTextNode(child.textContent || ''));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const nested = cleanNode(child);
          if (ALLOWED_TAGS.has(child.tagName)) {
            const safe = document.createElement(child.tagName.toLowerCase());
            safe.append(nested);
            fragment.append(safe);
          } else {
            fragment.append(nested);
          }
        }
      });
      return fragment;
    };
    const container = document.createElement('div');
    container.append(cleanNode(parsed.body));
    return container.innerHTML;
  }

  function plainText(html) {
    const node = document.createElement('div');
    node.innerHTML = sanitizeHtml(html);
    return node.textContent.trim().replace(/\s+/g, ' ');
  }

  function folderById(folderId) {
    return data.folders.find((folder) => folder.id === folderId);
  }

  function folderPath(folderId) {
    const parts = [];
    let folder = folderById(folderId);
    while (folder) {
      parts.unshift(folder.name);
      folder = folder.parentId ? folderById(folder.parentId) : null;
    }
    return parts.join(' / ');
  }

  function childFolders(folderId) {
    return data.folders.filter((folder) => (folder.parentId || null) === folderId);
  }

  function descendantIds(folderId) {
    const ids = [folderId];
    childFolders(folderId).forEach((folder) => ids.push(...descendantIds(folder.id)));
    return ids;
  }

  function cardsForFolder(folderId, includeChildren = true) {
    const ids = includeChildren ? descendantIds(folderId) : [folderId];
    return data.cards.filter((card) => ids.includes(card.folderId));
  }

  function isDue(card) {
    return !card.dueAt || new Date(card.dueAt).getTime() <= Date.now();
  }

  function formatDue(card) {
    if (isDue(card)) return 'Fällig';
    const remaining = new Date(card.dueAt).getTime() - Date.now();
    const minutes = Math.ceil(remaining / 60000);
    if (minutes < 60) return `In ${minutes} Min.`;
    const hours = Math.ceil(remaining / 3600000);
    if (hours < 24) return `In ${hours} Std.`;
    const days = Math.ceil(remaining / 86400000);
    if (days === 1) return 'Morgen';
    return `In ${days} Tagen`;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2600);
  }

  function addOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function fillFolderSelect(select, includeAllOption = false) {
    select.replaceChildren();
    if (includeAllOption) addOption(select, '', 'Alle Karten');
    data.folders.forEach((folder) => {
      const depth = folderPath(folder.id).split(' / ').length - 1;
      addOption(select, folder.id, `${'— '.repeat(depth)}${folder.name}`);
    });
  }

  function renderNavigation() {
    elements.folderNav.replaceChildren();
    const allButton = makeNavButton(null, '⌂', 'Alle Karten', data.cards.length);
    elements.folderNav.append(allButton);
    const appendTree = (parentId, depth) => {
      childFolders(parentId).forEach((folder) => {
        const button = makeNavButton(folder.id, EMOJIS[depth % EMOJIS.length], folder.name, cardsForFolder(folder.id).length, depth);
        elements.folderNav.append(button);
        appendTree(folder.id, depth + 1);
      });
    };
    appendTree(null, 0);
  }

  function makeNavButton(folderId, emoji, name, count, depth = 0) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `folder-nav-item${selectedFolderId === folderId ? ' active' : ''}`;
    button.style.paddingLeft = `${11 + depth * 12}px`;
    button.innerHTML = `<span class="folder-emoji">${emoji}</span><span class="folder-nav-name"></span><span class="folder-nav-count">${count}</span>`;
    button.querySelector('.folder-nav-name').textContent = name;
    button.addEventListener('click', () => {
      selectedFolderId = folderId;
      render();
    });
    return button;
  }

  function renderFolderCards(folders) {
    elements.folderCards.replaceChildren();
    folders.forEach((folder) => {
      const card = document.createElement('div');
      card.className = 'folder-card';
      const count = cardsForFolder(folder.id).length;
      const depth = folderPath(folder.id).split(' / ').length - 1;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'folder-card-open';
      open.innerHTML = `<span class="folder-card-top"><span class="folder-card-emoji">${EMOJIS[depth % EMOJIS.length]}</span><span class="folder-card-arrow">→</span></span><span class="folder-card-name"></span><span class="folder-card-meta">${count} ${count === 1 ? 'Karte' : 'Karten'} · ${childFolders(folder.id).length} Unterordner</span>`;
      open.querySelector('.folder-card-name').textContent = folder.name;
      open.addEventListener('click', () => {
        selectedFolderId = folder.id;
        render();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'folder-card-delete';
      remove.textContent = 'Löschen';
      remove.setAttribute('aria-label', `Ordner ${folder.name} löschen`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteFolder(folder.id);
      });
      card.append(open, remove);
      elements.folderCards.append(card);
    });
  }

  function renderCards(cards) {
    elements.cardsArea.replaceChildren();
    cards.forEach((card) => {
      const row = document.createElement('article');
      row.className = 'card-row';
      const main = document.createElement('div');
      main.className = 'card-row-main';
      main.innerHTML = '<span class="card-row-mark">▤</span><div class="card-row-text"><div class="card-row-front"></div><div class="card-row-folder"></div></div>';
      main.querySelector('.card-row-front').textContent = plainText(card.front) || '(Ohne Text)';
      main.querySelector('.card-row-folder').textContent = folderPath(card.folderId);
      const actions = document.createElement('div');
      actions.className = 'card-row-actions';
      const due = document.createElement('span');
      due.className = `due-tag${isDue(card) ? '' : ' not-due'}`;
      due.textContent = formatDue(card);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-card';
      remove.textContent = 'Löschen';
      remove.setAttribute('aria-label', 'Karte löschen');
      remove.addEventListener('click', () => {
        if (confirm('Möchtest du diese Karte wirklich löschen?')) {
          data.cards = data.cards.filter((item) => item.id !== card.id);
          saveData();
          render();
          showToast('Karte gelöscht.');
        }
      });
      actions.append(due, remove);
      row.append(main, actions);
      elements.cardsArea.append(row);
    });
  }

  function render() {
    renderNavigation();
    elements.totalCount.textContent = String(data.cards.length);
    elements.folderCount.textContent = String(data.folders.length);
    const dueCards = data.cards.filter(isDue);
    elements.dueCount.textContent = String(dueCards.length);
    elements.dueFoot.textContent = dueCards.length ? 'Karten warten auf dich' : 'Bereit, wenn du es bist';
    const learnAllButton = $('#learn-all');
    learnAllButton.disabled = dueCards.length === 0;
    learnAllButton.style.opacity = learnAllButton.disabled ? '.5' : '1';
    const today = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    elements.dateLabel.textContent = today.toLocaleUpperCase('de-DE');
    const selected = folderById(selectedFolderId);
    const hasFolders = data.folders.length > 0;
    const isHome = !selected;
    const visibleCards = selected ? cardsForFolder(selected.id, false) : data.cards;
    elements.currentFolder.textContent = selected ? selected.name : 'Alle Karten';
    elements.pageTitle.textContent = selected ? selected.name : 'Lernen, das bleibt.';
    const selectedCardCount = selected ? cardsForFolder(selected.id).length : 0;
    elements.pageSubtitle.textContent = selected ? `${selectedCardCount} ${selectedCardCount === 1 ? 'Karte' : 'Karten'} in diesem Ordner und seinen Unterordnern.` : 'Ein kleiner Schritt heute. Ein großer Unterschied morgen.';
    elements.listTitle.textContent = selected ? 'Karten in diesem Ordner' : 'Deine Ordner';
    elements.listDescription.textContent = selected ? 'Lerne die Karten hier oder stöbere in deinen Unterordnern.' : 'Wähle einen Ordner zum Lernen oder Stöbern.';
    elements.learnCurrent.textContent = selected ? 'Ordner lernen →' : 'Alles lernen →';
    elements.learnCurrent.disabled = selected ? !cardsForFolder(selected.id).some(isDue) : !data.cards.some(isDue);
    elements.learnCurrent.style.opacity = elements.learnCurrent.disabled ? '.5' : '1';
    elements.folderCards.hidden = !isHome && !childFolders(selected.id).length;
    renderFolderCards(isHome ? childFolders(null) : childFolders(selected.id));
    elements.cardsArea.hidden = isHome || !visibleCards.length;
    if (!elements.cardsArea.hidden) renderCards(visibleCards);
    const showEmpty = isHome ? !hasFolders : !visibleCards.length && !childFolders(selected.id).length;
    elements.emptyState.hidden = !showEmpty;
    if (showEmpty) {
      elements.emptyTitle.textContent = isHome ? 'Hier fängt dein Wissen an.' : 'Dieser Ordner ist noch leer.';
      elements.emptyDescription.textContent = isHome ? 'Lege deinen ersten Ordner an und bring deine Gedanken in Ordnung.' : 'Erstelle die erste Karte oder füge einen Unterordner hinzu.';
      elements.emptyAction.textContent = isHome ? '＋ Ordner erstellen' : '＋ Karte erstellen';
      elements.emptyAction.onclick = () => isHome ? openFolderDialog() : openCardDialog(selected.id);
      elements.folderCards.hidden = true;
      elements.cardsArea.hidden = true;
    }
    if (isHome && hasFolders && data.cards.length === 0) elements.folderCards.hidden = false;
    fillFolderSelect(elements.folderParent, true);
    fillFolderSelect(elements.cardFolder);
    if (selected && [...elements.cardFolder.options].some((option) => option.value === selected.id)) elements.cardFolder.value = selected.id;
  }

  function openFolderDialog() {
    fillFolderSelect(elements.folderParent, true);
    elements.folderParent.value = selectedFolderId || '';
    elements.folderName.value = '';
    elements.folderDialog.showModal();
    elements.folderName.focus();
  }

  function openCardDialog(folderId = selectedFolderId) {
    if (!data.folders.length) {
      showToast('Lege zuerst einen Ordner an.');
      openFolderDialog();
      return;
    }
    fillFolderSelect(elements.cardFolder);
    if (folderId && [...elements.cardFolder.options].some((option) => option.value === folderId)) elements.cardFolder.value = folderId;
    elements.front.innerHTML = '';
    elements.back.innerHTML = '';
    elements.cardDialog.showModal();
    elements.front.focus();
  }

  function deleteFolder(folderId) {
    const ids = descendantIds(folderId);
    const affectedCards = data.cards.filter((card) => ids.includes(card.folderId)).length;
    const name = folderById(folderId)?.name || 'diesen Ordner';
    const message = affectedCards
      ? `„${name}“ und alle Unterordner mit insgesamt ${affectedCards} Karten löschen?`
      : `„${name}“ und alle Unterordner löschen?`;
    if (!confirm(message)) return;
    data.folders = data.folders.filter((folder) => !ids.includes(folder.id));
    data.cards = data.cards.filter((card) => !ids.includes(card.folderId));
    if (ids.includes(selectedFolderId)) selectedFolderId = null;
    saveData();
    render();
    showToast('Ordner gelöscht.');
  }

  function startLearning(cards) {
    if (!cards.length) {
      showToast('Für diese Auswahl ist gerade keine Karte fällig.');
      return;
    }
    studyQueue = [...cards].sort((a, b) => Number(isDue(b)) - Number(isDue(a)));
    studyIndex = 0;
    showStudyCard();
    elements.studyDialog.showModal();
  }

  function showStudyCard() {
    const card = studyQueue[studyIndex];
    showingAnswer = false;
    elements.studyProgress.textContent = `KARTE ${studyIndex + 1} VON ${studyQueue.length}`;
    elements.studyFolder.textContent = folderPath(card.folderId);
    elements.studySide.textContent = 'VORDERSEITE';
    elements.studyContent.innerHTML = sanitizeHtml(card.front);
    elements.studyHint.textContent = 'Denk kurz nach, bevor du umdrehst.';
    elements.flip.hidden = false;
    elements.ratingArea.hidden = true;
  }

  function revealAnswer() {
    const card = studyQueue[studyIndex];
    showingAnswer = true;
    elements.studySide.textContent = 'RÜCKSEITE';
    elements.studyContent.innerHTML = sanitizeHtml(card.back);
    elements.studyHint.textContent = '';
    elements.flip.hidden = true;
    elements.ratingArea.hidden = false;
  }

  function rateCard(rating) {
    const card = studyQueue[studyIndex];
    card.dueAt = new Date(Date.now() + INTERVALS[rating]).toISOString();
    card.lastRating = rating;
    saveData();
    studyIndex += 1;
    if (studyIndex < studyQueue.length) {
      showStudyCard();
      return;
    }
    elements.studyDialog.close();
    render();
    showToast(`Lerneinheit geschafft! ${RATING_NAMES[rating]} · nächste Wiederholung vorgemerkt.`);
  }

  elements.folderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = elements.folderName.value.trim();
    if (!name) return;
    const parentId = elements.folderParent.value || null;
    const folder = { id: id(), name, parentId, createdAt: new Date().toISOString() };
    data.folders.push(folder);
    selectedFolderId = folder.id;
    saveData();
    elements.folderDialog.close();
    render();
    showToast(`Ordner „${name}“ angelegt.`);
  });

  elements.cardForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const folderId = elements.cardFolder.value;
    const front = sanitizeHtml(elements.front.innerHTML);
    const back = sanitizeHtml(elements.back.innerHTML);
    if (!folderId || !plainText(front) || !plainText(back)) {
      showToast('Bitte fülle Vorder- und Rückseite aus.');
      return;
    }
    data.cards.push({ id: id(), folderId, front, back, createdAt: new Date().toISOString(), dueAt: null });
    saveData();
    elements.cardDialog.close();
    selectedFolderId = folderId;
    render();
    showToast('Karte gespeichert. Viel Erfolg beim Lernen!');
  });

  document.querySelectorAll('.editor-toolbar button').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const editor = button.closest('.editor-wrap').querySelector('.rich-editor');
      editor.focus();
      const command = button.dataset.command;
      document.execCommand(command, false, button.dataset.value || null);
      editor.innerHTML = sanitizeHtml(editor.innerHTML);
    });
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.close).close());
  });
  [elements.folderDialog, elements.cardDialog, elements.studyDialog].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  $('#open-folder-form').addEventListener('click', openFolderDialog);
  $('#add-card').addEventListener('click', () => openCardDialog());
  $('#learn-all').addEventListener('click', () => startLearning(data.cards.filter(isDue)));
  elements.learnCurrent.addEventListener('click', () => startLearning((selectedFolderId ? cardsForFolder(selectedFolderId) : data.cards).filter(isDue)));
  elements.flip.addEventListener('click', revealAnswer);
  elements.ratingArea.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rating]');
    if (button && showingAnswer) rateCard(button.dataset.rating);
  });
  $('#export-data').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `karteikarten-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Dein Datenexport wurde erstellt.');
  });

  $('#import-file').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported.folders) || !Array.isArray(imported.cards)) throw new Error('Datei enthält keine gültigen Karteikartendaten.');
      if (!confirm('Import ersetzt deine aktuell gespeicherten Ordner und Karten. Möchtest du fortfahren?')) return;
      const folders = normalizeFolders(imported.folders);
      const folderIds = new Set(folders.map((folder) => folder.id));
      const cards = imported.cards.filter((card) => card && typeof card.id === 'string' && folderIds.has(card.folderId) && typeof card.front === 'string' && typeof card.back === 'string')
        .map((card) => ({ ...card, front: sanitizeHtml(card.front), back: sanitizeHtml(card.back) }));
      data = { folders, cards };
      selectedFolderId = null;
      saveData();
      render();
      showToast('Daten erfolgreich importiert.');
    } catch (error) {
      console.error('Der Import ist fehlgeschlagen.', error);
      showToast(`Import fehlgeschlagen: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  });

  render();
})();
