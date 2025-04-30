type MenuOptions = {
  selector: {
    button: string;
    list: string;
    item: string;
  };
  animation: {
    duration: number;
  };
};

export class Menu {
  private static hasOpen: Record<string, boolean> = {};
  private rootElement: HTMLElement;
  private name?: string;
  private defaults: MenuOptions;
  private settings: MenuOptions;
  private buttonElement: HTMLElement;
  private listElement: HTMLElement;
  private itemElements: NodeListOf<HTMLElement>;
  private itemElementsByInitial: Record<string, HTMLElement[]> = {};
  private animation: Animation | null = null;

  constructor(root: HTMLElement, options?: Partial<MenuOptions>) {
    this.rootElement = root;
    if (this.rootElement.hasAttribute('data-menu-name')) {
      this.name = this.rootElement.getAttribute('data-menu-name') || '';
    }
    this.defaults = {
      selector: {
        button: '[data-menu-button]',
        list: '[role="menu"]',
        item: '[role="menuitem"]',
      },
      animation: {
        duration: 300,
      },
    };
    this.settings = {
      selector: { ...this.defaults.selector, ...options?.selector },
      animation: { ...this.defaults.animation, ...options?.animation },
    };
    this.buttonElement = this.rootElement.querySelector(this.settings.selector.button) as HTMLElement;
    this.listElement = this.rootElement.querySelector(this.settings.selector.list) as HTMLElement;
    this.itemElements = this.rootElement.querySelectorAll(this.settings.selector.item);
    if (!this.listElement || !this.itemElements.length) {
      return;
    }
    this.itemElementsByInitial = {};
    this.animation = null;
    this.handleOutsidePointerDown = this.handleOutsidePointerDown.bind(this);
    this.handleRootFocusOut = this.handleRootFocusOut.bind(this);
    this.handleButtonPointerOver = this.handleButtonPointerOver.bind(this);
    this.handleButtonClick = this.handleButtonClick.bind(this);
    this.handleButtonKeyDown = this.handleButtonKeyDown.bind(this);
    this.handleListKeyDown = this.handleListKeyDown.bind(this);
    if (this.name && this.isFocusable(this.buttonElement)) {
      Menu.hasOpen[this.name] ||= false;
    }
    this.initialize();
  }

  private initialize(): void {
    document.addEventListener('pointerdown', this.handleOutsidePointerDown);
    this.rootElement.addEventListener('focusout', this.handleRootFocusOut);
    if (this.buttonElement) {
      const id = Math.random().toString(36).slice(-8);
      this.buttonElement.setAttribute('aria-controls', (this.listElement.id ||= `menu-list-${id}`));
      this.buttonElement.setAttribute('aria-expanded', 'false');
      this.buttonElement.setAttribute('aria-haspopup', 'menu');
      this.buttonElement.setAttribute('id', this.buttonElement.getAttribute('id') || `menu-button-${id}`);
      this.buttonElement.setAttribute('tabindex', this.isFocusable(this.buttonElement) ? '0' : '-1');
      if (!this.isFocusable(this.buttonElement)) {
        this.buttonElement.style.setProperty('pointer-events', 'none');
      }
      this.buttonElement.addEventListener('pointerover', this.handleButtonPointerOver);
      this.buttonElement.addEventListener('click', this.handleButtonClick);
      this.buttonElement.addEventListener('keydown', this.handleButtonKeyDown);
      this.listElement.setAttribute('aria-labelledby', `${this.listElement.getAttribute('aria-labelledby') || ''} ${this.buttonElement.getAttribute('id')}`.trim());
    }
    this.listElement.addEventListener('keydown', this.handleListKeyDown);
    this.itemElements.forEach(item => {
      const initial = item.textContent!.trim().charAt(0).toLowerCase();
      if (/[a-z]/.test(initial)) {
        item.setAttribute('aria-keyshortcuts', initial);
        (this.itemElementsByInitial[initial] ||= []).push(item);
      }
    });
    this.resetTabIndex();
    this.rootElement.setAttribute('data-menu-initialized', '');
  }

  private isFocusable(element: HTMLElement): boolean {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }

  private resetTabIndex(): void {
    this.itemElements.forEach(item => {
      item.removeAttribute('tabindex');
    });
    this.itemElements.forEach(item => {
      item.setAttribute('tabindex', this.isFocusable(item) && [...this.itemElements].filter(this.isFocusable).findIndex(item => item.getAttribute('tabindex') === '0') === -1 ? '0' : '-1');
    });
  }

  private toggle(isOpen: boolean): void {
    if (this.name) {
      Menu.hasOpen[this.name] = isOpen;
    }
    window.requestAnimationFrame(() => {
      this.buttonElement.setAttribute('aria-expanded', String(isOpen));
    });
    if (isOpen) {
      this.listElement.style.setProperty('display', 'block');
      this.listElement.style.setProperty('opacity', '0');
    }
    const opacity = window.getComputedStyle(this.listElement).getPropertyValue('opacity');
    if (this.animation) {
      this.animation.cancel();
    }
    this.animation = this.listElement.animate({ opacity: isOpen ? [opacity, '1'] : [opacity, '0'] }, { duration: this.settings.animation.duration, easing: 'ease' });
    this.animation.addEventListener('finish', () => {
      this.animation = null;
      if (!isOpen) {
        this.listElement.style.setProperty('display', 'none');
      }
      this.listElement.style.removeProperty('opacity');
    });
  }

  private handleOutsidePointerDown(event: PointerEvent): void {
    if (this.rootElement.contains(event.target as HTMLElement) || !this.buttonElement) {
      return;
    }
    this.close();
  }

  private handleRootFocusOut(event: FocusEvent): void {
    if (!event.relatedTarget || (this.buttonElement && this.buttonElement.getAttribute('aria-expanded') !== 'true')) {
      return;
    }
    if (!this.rootElement.contains(event.relatedTarget as HTMLElement)) {
      if (this.buttonElement) {
        this.close();
      } else {
        this.resetTabIndex();
      }
    }
  }

  private handleButtonPointerOver(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || !this.name || !Menu.hasOpen[this.name]) {
      return;
    }
    this.buttonElement.focus();
    this.open();
  }

  private handleButtonClick(event: MouseEvent): void {
    event.preventDefault();
    const isOpen = this.buttonElement.getAttribute('aria-expanded') === 'true';
    this.toggle(!isOpen);
    const focusables = [...this.itemElements].filter(this.isFocusable);
    if (!focusables.length) {
      return;
    }
    if (!isOpen) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusables[0]!.focus();
        });
      });
    }
  }

  private handleButtonKeyDown(event: KeyboardEvent): void {
    const { key } = event;
    if (!['Enter', 'Escape', ' ', 'ArrowUp', 'ArrowDown'].includes(key)) {
      return;
    }
    event.preventDefault();
    if (!['Escape'].includes(key)) {
      this.open();
      const focusables = [...this.itemElements].filter(this.isFocusable);
      if (!focusables.length) {
        return;
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusables[key !== 'ArrowUp' ? 0 : focusables.length - 1]!.focus();
        });
      });
      return;
    }
    this.close();
  }

  private handleListKeyDown(event: KeyboardEvent): void {
    const { key, shiftKey } = event;
    if (!this.buttonElement && shiftKey && key === 'Tab') {
      return;
    }
    function isAlpha(value: string): boolean {
      return /^[a-z]$/i.test(value);
    }
    if (!(['Enter', 'Escape', ' ', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key) || (shiftKey && key === 'Tab') || (isAlpha(key) && this.itemElementsByInitial[key.toLowerCase()]?.filter(this.isFocusable).length))) {
      return;
    }
    event.preventDefault();
    const active = document.activeElement as HTMLElement;
    if (['Enter', ' '].includes(key)) {
      active.click();
      return;
    }
    if (['Tab', 'Escape'].includes(key)) {
      this.close();
      return;
    }
    const focusables = [...this.itemElements].filter(this.isFocusable);
    if (['ArrowUp', 'ArrowDown', 'End', 'Home'].includes(key)) {
      const currentIndex = focusables.indexOf(active);
      const length = focusables.length;
      let newIndex = 0;
      switch (key) {
        case 'ArrowUp':
          newIndex = (currentIndex - 1 + length) % length;
          break;
        case 'ArrowDown':
          newIndex = (currentIndex + 1) % length;
          break;
        case 'End':
          newIndex = length - 1;
          break;
      }
      if (!this.buttonElement) {
        focusables[currentIndex]!.setAttribute('tabindex', '-1');
        focusables[newIndex]!.setAttribute('tabindex', '0');
      }
      focusables[newIndex]!.focus();
      return;
    }
    const focusablesByInitial = this.itemElementsByInitial[key.toLowerCase()]!.filter(this.isFocusable);
    const index = focusablesByInitial.findIndex(item => focusables.indexOf(item) > focusables.indexOf(active));
    focusablesByInitial[index !== -1 ? index : 0]!.focus();
  }

  open(): void {
    if (!this.buttonElement || this.buttonElement.getAttribute('aria-expanded') === 'true') {
      return;
    }
    this.toggle(true);
  }

  close(): void {
    if (!this.buttonElement || this.buttonElement.getAttribute('aria-expanded') !== 'true') {
      return;
    }
    this.toggle(false);
    if (this.buttonElement && this.rootElement.contains(document.activeElement)) {
      this.buttonElement.focus();
    }
  }
}
