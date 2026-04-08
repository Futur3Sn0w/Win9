const { ipcRenderer } = require('electron');

const STEP_IDS = [
  'welcome',
  'install-now',
  'product-key',
  'license',
  'install-type',
  'drive',
  'progress',
  'complete'
];

const progressStages = [
  { id: 'copying-files', label: 'Copying Windows files' },
  { id: 'getting-files-ready', label: 'Getting files ready for installation' },
  { id: 'installing-features', label: 'Installing features' },
  { id: 'installing-updates', label: 'Installing updates' },
  { id: 'finishing-up', label: 'Finishing up' }
];

const BOOT_SEQUENCE_DURATION = 3200;
const BOOT_FADE_DURATION = 600;

let bootTimer = null;
let bootFadeTimer = null;
let bootCompleted = false;

const defaultState = {
  stepIndex: 0,
  language: 'en-US',
  timeRegion: 'en-US',
  keyboard: 'en-US',
  productKeySegments: ['', '', '', '', ''],
  productKeyProvided: false,
  licenseAccepted: false,
  installType: null,
  selectedDrive: 'simulator-drive',
  progress: {
    currentStage: null,
    completedStages: new Set(),
    inFlight: false
  },
  metadata: {
    startedAt: new Date().toISOString()
  }
};

const state = {
  ...defaultState,
  progress: {
    ...defaultState.progress,
    completedStages: new Set()
  }
};

document.addEventListener('DOMContentLoaded', () => {
  renderCurrentStep();
  startBootSequence();
});

function clearBootTimers() {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (bootFadeTimer) {
    clearTimeout(bootFadeTimer);
    bootFadeTimer = null;
  }
}

function startBootSequence() {
  const bootScreen = document.getElementById('boot-screen');
  clearBootTimers();
  bootCompleted = false;

  if (!bootScreen) {
    finalizeBootSequence();
    return;
  }

  document.body.classList.remove('boot-finished');
  bootScreen.classList.remove('fade-out', 'fade-in');
  bootScreen.classList.add('visible');

  // Force reflow before triggering fade-in for smooth animation when re-running
  void bootScreen.offsetWidth;
  bootScreen.classList.add('fade-in');

  bootTimer = setTimeout(() => {
    bootScreen.classList.remove('fade-in');
    bootScreen.classList.add('fade-out');
    bootFadeTimer = setTimeout(() => finalizeBootSequence(), BOOT_FADE_DURATION);
  }, BOOT_SEQUENCE_DURATION);
}

function finalizeBootSequence() {
  clearBootTimers();
  const bootScreen = document.getElementById('boot-screen');
  if (bootScreen) {
    bootScreen.classList.remove('visible', 'fade-in', 'fade-out');
  }
  bootCompleted = true;
  document.body.classList.add('boot-finished');
  renderCurrentStep();
}

function renderCurrentStep() {
  const root = document.getElementById('setup-root');
  if (!root) {
    return;
  }

  root.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'setup-shell';

  const panel = document.createElement('div');
  panel.className = 'setup-panel';

  const stepId = STEP_IDS[state.stepIndex];

  switch (stepId) {
    case 'welcome':
      renderWelcome(panel);
      break;
    case 'install-now':
      renderInstallNow(panel);
      break;
    case 'product-key':
      renderProductKey(panel);
      break;
    case 'license':
      renderLicense(panel);
      break;
    case 'install-type':
      renderInstallType(panel);
      break;
    case 'drive':
      renderDriveSelection(panel);
      break;
    case 'progress':
      renderProgress(panel);
      break;
    case 'complete':
      renderCompletion(panel);
      break;
    default:
      renderWelcome(panel);
      break;
  }

  container.appendChild(panel);
  root.appendChild(container);
}

function createHeader({ title, subtitle }) {
  const header = document.createElement('div');
  header.className = 'setup-header';

  const heading = document.createElement('h1');
  heading.textContent = title;

  header.appendChild(heading);

  if (subtitle) {
    const sub = document.createElement('p');
    sub.textContent = subtitle;
    header.appendChild(sub);
  }

  return header;
}

function createActions(actions = []) {
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'setup-actions';

  actions.forEach(action => {
    const button = document.createElement('button');
    button.className = `setup-button ${action.primary ? 'primary' : ''}`;
    button.textContent = action.label;
    button.disabled = Boolean(action.disabled);
    if (action.id) {
      button.dataset.actionId = action.id;
    }
    button.addEventListener('click', () => action.onClick && action.onClick());
    actionsContainer.appendChild(button);
  });

  return actionsContainer;
}

function renderWelcome(panel) {
  panel.appendChild(
    createHeader({
      title: 'Windows Setup',
      subtitle: 'Choose your language preferences and click Next to continue.'
    })
  );

  const form = document.createElement('div');
  form.className = 'setup-form';

  form.appendChild(createSelectField({
    label: 'Language to install',
    value: state.language,
    options: [
      { value: 'en-US', label: 'English (United States)' },
      { value: 'en-GB', label: 'English (United Kingdom)' },
      { value: 'fr-FR', label: 'French (France)' },
      { value: 'de-DE', label: 'German (Germany)' },
      { value: 'es-ES', label: 'Spanish (Spain)' }
    ],
    onChange: value => { state.language = value; }
  }));

  form.appendChild(createSelectField({
    label: 'Time and currency format',
    value: state.timeRegion,
    options: [
      { value: 'en-US', label: 'English (United States)' },
      { value: 'en-GB', label: 'English (United Kingdom)' },
      { value: 'fr-FR', label: 'French (France)' },
      { value: 'de-DE', label: 'German (Germany)' },
      { value: 'es-ES', label: 'Spanish (Spain)' }
    ],
    onChange: value => { state.timeRegion = value; }
  }));

  form.appendChild(createSelectField({
    label: 'Keyboard or input method',
    value: state.keyboard,
    options: [
      { value: 'en-US', label: 'US' },
      { value: 'en-UK', label: 'UK' },
      { value: 'fr-FR', label: 'French' },
      { value: 'de-DE', label: 'German' },
      { value: 'es-ES', label: 'Spanish' }
    ],
    onChange: value => { state.keyboard = value; }
  }));

  panel.appendChild(form);

  const footer = document.createElement('div');
  footer.className = 'setup-footer';
  footer.textContent = 'Repair your computer';
  panel.appendChild(footer);

  panel.appendChild(createActions([
    {
      label: 'Next',
      primary: true,
      onClick: () => moveToStep('install-now')
    }
  ]));
}

function createSelectField({ label, value, options, onChange }) {
  const field = document.createElement('div');
  field.className = 'setup-field';

  const fieldLabel = document.createElement('label');
  fieldLabel.textContent = label;

  const select = document.createElement('select');
  select.value = value;

  options.forEach(option => {
    const optionElement = document.createElement('option');
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    select.appendChild(optionElement);
  });

  select.addEventListener('change', event => {
    onChange(event.target.value);
  });

  field.appendChild(fieldLabel);
  field.appendChild(select);

  return field;
}

function renderInstallNow(panel) {
  panel.appendChild(
    createHeader({
      title: 'Install Windows',
      subtitle: 'Click Install now to begin the installation.'
    })
  );

  const centered = document.createElement('div');
  centered.className = 'setup-centered';

  centered.innerHTML = `
    <div class="setup-spinner"></div>
    <p>This is a simulated setup experience.</p>
  `;

  panel.appendChild(centered);

  panel.appendChild(createActions([
    {
      label: 'Back',
      onClick: () => moveToStep('welcome')
    },
    {
      label: 'Install now',
      primary: true,
      onClick: () => moveToStep('product-key')
    }
  ]));
}

function renderProductKey(panel) {
  panel.appendChild(
    createHeader({
      title: 'Enter the product key to activate Windows',
      subtitle: 'You can find it on the back of the box that Windows DVD came in.'
    })
  );

  const form = document.createElement('div');
  form.className = 'setup-form';

  const keyField = document.createElement('div');
  keyField.className = 'setup-field';

  const label = document.createElement('label');
  label.textContent = 'Product key (25 characters)';
  keyField.appendChild(label);

  const segmentContainer = document.createElement('div');
  segmentContainer.className = 'setup-product-key-input';

  let nextButtonRef = null;

  for (let index = 0; index < 5; index += 1) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 5;
    input.value = state.productKeySegments[index];
    input.addEventListener('input', event => {
      const value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      event.target.value = value;
      state.productKeySegments[index] = value;
      updateProductKeyFlag();
      if (nextButtonRef) {
        nextButtonRef.disabled = !state.productKeyProvided;
      }
      if (value.length === 5 && index < 4) {
        const next = segmentContainer.querySelectorAll('input')[index + 1];
        if (next) {
          next.focus();
        }
      }
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Backspace' && event.target.value.length === 0 && index > 0) {
        const prev = segmentContainer.querySelectorAll('input')[index - 1];
        if (prev) {
          prev.focus();
        }
      }
    });

    segmentContainer.appendChild(input);
  }

  keyField.appendChild(segmentContainer);

  const helper = document.createElement('div');
  helper.className = 'setup-footer';
  helper.textContent = 'You can skip this step to enter the key later.';
  keyField.appendChild(helper);

  form.appendChild(keyField);

  panel.appendChild(form);

  const actions = createActions([
    {
      id: 'back',
      label: 'Back',
      onClick: () => moveToStep('install-now')
    },
    {
      id: 'skip',
      label: 'Skip',
      onClick: () => {
        state.productKeySegments = ['', '', '', '', ''];
        state.productKeyProvided = false;
        moveToStep('license');
      }
    },
    {
      id: 'next',
      label: 'Next',
      primary: true,
      disabled: !hasFullProductKey(),
      onClick: () => moveToStep('license')
    }
  ]);

  panel.appendChild(actions);

  nextButtonRef = actions.querySelector('[data-action-id="next"]');
}

function updateProductKeyFlag() {
  state.productKeyProvided = hasFullProductKey();
}

function hasFullProductKey() {
  return state.productKeySegments.every(segment => segment.length === 5);
}

function renderLicense(panel) {
  panel.appendChild(
    createHeader({
      title: 'License terms',
      subtitle: 'Read the license terms. You must accept to continue installing Windows.'
    })
  );

  const form = document.createElement('div');
  form.className = 'setup-form';

  const licenseText = document.createElement('div');
  licenseText.className = 'setup-license-text';
  licenseText.textContent = generateLicenseBlurb();
  form.appendChild(licenseText);

  const checkboxContainer = document.createElement('label');
  checkboxContainer.className = 'setup-checkbox';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = state.licenseAccepted;
  checkbox.addEventListener('change', event => {
    state.licenseAccepted = event.target.checked;
    renderCurrentStep();
  });

  const checkboxLabel = document.createElement('span');
  checkboxLabel.textContent = 'I accept the license terms';

  checkboxContainer.appendChild(checkbox);
  checkboxContainer.appendChild(checkboxLabel);

  form.appendChild(checkboxContainer);

  panel.appendChild(form);

  panel.appendChild(createActions([
    {
      label: 'Back',
      onClick: () => moveToStep('product-key')
    },
    {
      label: 'Next',
      primary: true,
      disabled: !state.licenseAccepted,
      onClick: () => moveToStep('install-type')
    }
  ]));
}

function generateLicenseBlurb() {
  return [
    'By using the simulator you agree to the Microsoft Software License Terms as reproduced for this educational experience.',
    '',
    'This limited recreation mirrors the Windows 9/8.1 setup experience. No actual changes are made to your device. All data entered here remains within the simulator environment.',
    '',
    'If you accept these terms, select the checkbox below. Selecting “I do not accept the license terms” will cancel setup.'
  ].join('\n');
}

function renderInstallType(panel) {
  panel.appendChild(
    createHeader({
      title: 'Which type of installation do you want?',
      subtitle: 'Upgrade keeps files, settings, and apps. Custom installs a clean copy.'
    })
  );

  const options = document.createElement('div');
  options.className = 'setup-form';

  const upgradeOption = createInstallTypeCard({
    id: 'upgrade',
    title: 'Upgrade: Install Windows and keep files, settings, and applications',
    description: 'Only available when running setup from a supported version of Windows. Retains your personal content.',
    disabled: true,
    note: 'Requires an existing Windows installation.'
  });

  const customOption = createInstallTypeCard({
    id: 'custom',
    title: 'Custom: Install Windows only (advanced)',
    description: 'Choose where to install Windows. You can make changes to partitions and drives.',
    disabled: false
  });

  options.appendChild(upgradeOption);
  options.appendChild(customOption);

  panel.appendChild(options);

  panel.appendChild(createActions([
    {
      label: 'Back',
      onClick: () => moveToStep('license')
    },
    {
      label: 'Next',
      primary: true,
      disabled: state.installType !== 'custom',
      onClick: () => moveToStep('drive')
    }
  ]));
}

function createInstallTypeCard({ id, title, description, disabled, note }) {
  const card = document.createElement('div');
  card.className = 'setup-field';
  card.style.background = 'rgba(255, 255, 255, 0.05)';
  card.style.padding = '20px';
  card.style.borderRadius = '4px';
  card.style.cursor = disabled ? 'not-allowed' : 'pointer';
  card.style.border = state.installType === id ? '1px solid var(--setup-accent-color)' : '1px solid rgba(255,255,255,0.15)';

  const heading = document.createElement('strong');
  heading.textContent = title;
  heading.style.display = 'block';
  heading.style.marginBottom = '10px';

  const detail = document.createElement('span');
  detail.textContent = description;
  detail.style.display = 'block';
  detail.style.color = 'var(--setup-text-muted)';
  detail.style.lineHeight = '1.4';

  card.appendChild(heading);
  card.appendChild(detail);

  if (note) {
    const noteText = document.createElement('span');
    noteText.textContent = note;
    noteText.style.display = 'block';
    noteText.style.marginTop = '10px';
    noteText.style.color = 'rgba(255,255,255,0.45)';
    card.appendChild(noteText);
  }

  if (!disabled) {
    card.addEventListener('click', () => {
      state.installType = id;
      renderCurrentStep();
    });
  }

  return card;
}

function renderDriveSelection(panel) {
  panel.appendChild(
    createHeader({
      title: 'Where do you want to install Windows?',
      subtitle: 'Drives and partitions from the host are not exposed. A virtual drive is used in the simulator.'
    })
  );

  const table = document.createElement('div');
  table.className = 'setup-form';

  const driveCard = document.createElement('div');
  driveCard.className = 'setup-field';
  driveCard.style.background = 'rgba(255, 255, 255, 0.05)';
  driveCard.style.padding = '16px';
  driveCard.style.borderRadius = '4px';
  driveCard.style.border = '1px solid rgba(255, 255, 255, 0.15)';

  const label = document.createElement('strong');
  label.textContent = 'Drive 0 Unallocated Space';
  label.style.display = 'block';
  label.style.marginBottom = '8px';

  const meta = document.createElement('span');
  meta.textContent = 'Total size: 60.0 GB   |   Free space: 60.0 GB';
  meta.style.display = 'block';
  meta.style.color = 'var(--setup-text-muted)';

  driveCard.appendChild(label);
  driveCard.appendChild(meta);

  table.appendChild(driveCard);

  panel.appendChild(table);

  panel.appendChild(createActions([
    {
      label: 'Back',
      onClick: () => moveToStep('install-type')
    },
    {
      label: 'Next',
      primary: true,
      onClick: () => {
        state.selectedDrive = 'drive0';
        moveToStep('progress');
      }
    }
  ]));
}

function renderProgress(panel) {
  panel.appendChild(
    createHeader({
      title: 'Installing Windows',
      subtitle: 'The simulator is preparing the default Windows environment.'
    })
  );

  const progressList = document.createElement('ul');
  progressList.className = 'setup-progress-list';

  progressStages.forEach(stage => {
    const item = document.createElement('li');
    item.className = 'setup-progress-item';

    const dot = document.createElement('div');
    dot.className = 'status-dot';

    if (state.progress.completedStages.has(stage.id)) {
      item.classList.add('completed');
    } else if (state.progress.currentStage === stage.id) {
      item.classList.add('active');
    }

    item.appendChild(dot);

    const text = document.createElement('span');
    text.textContent = stage.label;
    item.appendChild(text);

    progressList.appendChild(item);
  });

  panel.appendChild(progressList);

  panel.appendChild(createActions([
    {
      label: 'Cancel',
      onClick: () => moveToStep('drive'),
      disabled: state.progress.inFlight
    }
  ]));

  if (!state.progress.inFlight) {
    startProgressSequence();
  }
}

function startProgressSequence() {
  state.progress.inFlight = true;
  runStage(0);
}

function runStage(index) {
  if (index >= progressStages.length) {
    completeInstallation();
    return;
  }

  const stage = progressStages[index];
  state.progress.currentStage = stage.id;
  renderCurrentStep();

  const duration = stageDuration(stage.id);

  setTimeout(() => {
    state.progress.completedStages.add(stage.id);
    renderCurrentStep();
    runStage(index + 1);
  }, duration);
}

function stageDuration(id) {
  switch (id) {
    case 'copying-files':
      return 1500;
    case 'getting-files-ready':
      return 2200;
    case 'installing-features':
      return 1200;
    case 'installing-updates':
      return 1800;
    case 'finishing-up':
      return 1200;
    default:
      return 1000;
  }
}

async function completeInstallation() {
  state.progress.currentStage = null;
  state.progress.inFlight = false;
  state.metadata.completedAt = new Date().toISOString();

  const payload = buildSetupPayload();

  try {
    await ipcRenderer.invoke('setup-complete', payload);
  } catch (error) {
    console.error('[Setup] Failed to signal completion:', error);
  }

  moveToStep('complete');
}

function buildSetupPayload() {
  return {
    selections: {
      language: state.language,
      locale: state.timeRegion,
      keyboard: state.keyboard,
      productKey: state.productKeyProvided ? state.productKeySegments.join('-') : null,
      licenseAccepted: state.licenseAccepted,
      installType: state.installType,
      targetDrive: state.selectedDrive
    },
    timestamps: {
      startedAt: state.metadata.startedAt,
      completedAt: state.metadata.completedAt
    }
  };
}

function renderCompletion(panel) {
  panel.appendChild(
    createHeader({
      title: 'Installation complete',
      subtitle: 'Windows Setup has finished. Your simulator will continue with first-time setup.'
    })
  );

  const centered = document.createElement('div');
  centered.className = 'setup-centered';
  centered.innerHTML = `
    <div class="setup-spinner"></div>
    <h2>Getting ready</h2>
    <p>The system will restart automatically.</p>
  `;

  panel.appendChild(centered);

  panel.appendChild(createActions([
    {
      label: 'Restart now',
      primary: true,
      onClick: () => ipcRenderer.send('setup-request-restart')
    }
  ]));
}

function moveToStep(stepId) {
  const index = STEP_IDS.indexOf(stepId);
  if (index === -1) {
    return;
  }

  state.stepIndex = index;

  if (stepId !== 'progress') {
    state.progress.inFlight = false;
    state.progress.currentStage = null;
  }

  renderCurrentStep();
}

function resetSetupState() {
  state.stepIndex = 0;
  state.language = defaultState.language;
  state.timeRegion = defaultState.timeRegion;
  state.keyboard = defaultState.keyboard;
  state.productKeySegments = ['', '', '', '', ''];
  state.productKeyProvided = false;
  state.licenseAccepted = false;
  state.installType = null;
  state.selectedDrive = defaultState.selectedDrive;
  state.progress.completedStages.clear();
  state.progress.currentStage = null;
  state.progress.inFlight = false;
  state.metadata.startedAt = new Date().toISOString();
  delete state.metadata.completedAt;
  bootCompleted = false;
}

ipcRenderer.on('setup-reset', () => {
  resetSetupState();
  renderCurrentStep();
  startBootSequence();
});
