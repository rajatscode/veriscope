// layout.ts — Tab layout: Circuit | Waveform | Live Assertions | Autotest | Mutants

export type TabId = 'circuit' | 'waveform' | 'live-assertions' | 'autotest' | 'mutants';

export interface TabDefinition {
  id: TabId;
  label: string;
}

const TABS: TabDefinition[] = [
  { id: 'circuit', label: 'Circuit' },
  { id: 'waveform', label: 'Waveform' },
  { id: 'live-assertions', label: 'Live Assertions' },
  { id: 'autotest', label: 'Autotest' },
  { id: 'mutants', label: 'Mutants' },
];

export interface TabLayout {
  container: HTMLElement;
  tabBar: HTMLElement;
  contentPanels: Map<TabId, HTMLElement>;
  activeTab: TabId;
  setActive: (tab: TabId) => void;
  onTabChange: (cb: (tab: TabId) => void) => void;
  dispose: () => void;
}

export function createTabLayout(container: HTMLElement): TabLayout {
  container.style.cssText = 'display:flex; flex-direction:column; height:100%; background:#0d1117; color:#c9d1d9; border:1px solid #21262d; border-radius:6px; overflow:hidden;';

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:4px 12px; background:#161b22; border-bottom:1px solid #21262d; flex-shrink:0;';
  const titleLabel = document.createElement('span');
  titleLabel.style.cssText = 'font-size:0.75rem; font-weight:600; color:#c9d1d9; font-family:"SF Mono","Fira Code",monospace; letter-spacing:0.5px;';
  titleLabel.textContent = 'VERISCOPE DEVTOOLS';
  titleBar.appendChild(titleLabel);
  container.appendChild(titleBar);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex; gap:0; background:#161b22; border-bottom:1px solid #21262d; flex-shrink:0;';
  container.appendChild(tabBar);

  // Content area
  const contentArea = document.createElement('div');
  contentArea.style.cssText = 'flex:1; min-height:0; position:relative;';
  container.appendChild(contentArea);

  // Create tab buttons and content panels
  const tabButtons = new Map<TabId, HTMLElement>();
  const contentPanels = new Map<TabId, HTMLElement>();
  let activeTab: TabId = 'circuit';
  const changeListeners: Array<(tab: TabId) => void> = [];

  for (const tab of TABS) {
    // Button
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none; border:none; border-bottom:2px solid transparent; color:#666; padding:6px 14px; cursor:pointer; font-size:0.75rem; font-family:"SF Mono","Fira Code",monospace; transition:all 0.15s;';
    btn.textContent = tab.label;
    btn.addEventListener('click', () => setActive(tab.id));
    btn.addEventListener('mouseenter', () => {
      if (activeTab !== tab.id) btn.style.color = '#c9d1d9';
    });
    btn.addEventListener('mouseleave', () => {
      if (activeTab !== tab.id) btn.style.color = '#666';
    });
    tabBar.appendChild(btn);
    tabButtons.set(tab.id, btn);

    // Content panel
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute; top:0; left:0; right:0; bottom:0; display:none;';
    contentArea.appendChild(panel);
    contentPanels.set(tab.id, panel);
  }

  function setActive(tab: TabId) {
    activeTab = tab;
    for (const [id, btn] of tabButtons) {
      if (id === tab) {
        btn.style.borderBottomColor = '#6ee7f9';
        btn.style.color = '#c9d1d9';
      } else {
        btn.style.borderBottomColor = 'transparent';
        btn.style.color = '#666';
      }
    }
    for (const [id, panel] of contentPanels) {
      panel.style.display = id === tab ? 'block' : 'none';
    }
    for (const cb of changeListeners) cb(tab);
  }

  // Initialize first tab
  setActive('circuit');

  return {
    container,
    tabBar,
    contentPanels,
    activeTab,
    setActive,
    onTabChange(cb) { changeListeners.push(cb); },
    dispose() { container.innerHTML = ''; },
  };
}
