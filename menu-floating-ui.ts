import { Middleware, Placement, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';

type MenuOptions = {
  selector: {
    button: string;
    list: string;
    item: string;
  };
  animation: {
    duration: number;
  };
  delay: number;
  floatingUi: {
    menu: Partial<MenuFloatingUiOptions>;
    submenu: Partial<MenuFloatingUiOptions>;
    transformOrigin: boolean;
  };
};

type MenuFloatingUiOptions = {
  middleware: Middleware[];
  placement: Placement;
};

export class Menu {
  private rootElement: HTMLElement;
  private defaults: MenuOptions;
  private settings: MenuOptions;
  private buttonElement: HTMLElement;
  private listElement: HTMLElement;
  private itemElements: HTMLElement[];
  private itemElementsByInitial!: Record<string, HTMLElement[]>;
  private checkboxItemElements!: HTMLElement[];
  private radioItemElements!: HTMLElement[];
  private radioItemElementsByGroup!: Map<HTMLElement, HTMLElement[]>;
  private animation!: Animation | null;
  private name?: string;
  private isSubmenu: boolean;
  private submenus: Menu[] = [];
  private submenuTimer!: number;
  private static menus: Menu[] = [];
  private static hasOpen: Record<string, boolean> = {};
  private cleanupFloatingUi!: Function | null;

  constructor(root: HTMLElement, options?: Partial<MenuOptions>, isSubmenu = false) {
    this.rootElement = root;
    this.defaults = {
      selector: {
        button: '[data-menu-button]',
        list: '[role="menu"]',
        item: '[role^="menuitem"]',
      },
      animation: {
        duration: 300,
      },
      delay: 300,
      floatingUi: {
        menu: {
          middleware: [flip(), offset(), shift()],
          placement: 'bottom-start',
        },
        submenu: {
          middleware: [flip(), offset(), shift()],
          placement: 'right-start',
        },
        transformOrigin: true,
      },
    };
    this.settings = {
      ...this.defaults,
      ...options,
      selector: {
        ...this.defaults.selector,
        ...options?.selector,
      },
      animation: {
        ...this.defaults.animation,
        ...options?.animation,
      },
      floatingUi: {
        ...this.defaults.floatingUi,
        ...options?.floatingUi,
        menu: {
          ...this.defaults.floatingUi.menu,
          ...options?.floatingUi?.menu,
        },
        submenu: {
          ...this.defaults.floatingUi.submenu,
          ...options?.floatingUi?.submenu,
        },
      },
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.animation.duration = 0;
    }
    this.isSubmenu = isSubmenu;
    this.buttonElement = this.rootElement.querySelector(this.settings.selector[!this.isSubmenu ? 'button' : 'item']) as HTMLElement;
    this.listElement = this.rootElement.querySelector(this.settings.selector.list) as HTMLElement;
    this.itemElements = [...this.listElement.querySelectorAll(`${this.settings.selector.item}:not(:scope ${this.settings.selector.list} *)`)] as HTMLElement[];
    if (!this.listElement || !this.itemElements.length) {
      return;
    }
    this.itemElementsByInitial = {};
    this.itemElements.forEach(item => {
      const initial = item.textContent!.trim().charAt(0).toLowerCase();
      if (/[a-z]/.test(initial)) {
        item.setAttribute('aria-keyshortcuts', initial);
        (this.itemElementsByInitial[initial] ||= []).push(item);
      }
    });
    this.checkboxItemElements = this.itemElements.filter(item => item.getAttribute('role') === 'menuitemcheckbox');
    this.radioItemElements = this.itemElements.filter(item => item.getAttribute('role') === 'menuitemradio');
    this.radioItemElementsByGroup = new Map();
    if (this.radioItemElements.length) {
      this.radioItemElements.forEach(item => {
        let group = item.closest('[role="group"]') as HTMLElement;
        if (!group || !this.rootElement.contains(group)) {
          group = this.rootElement;
        }
        (this.radioItemElementsByGroup.get(group) ?? this.radioItemElementsByGroup.set(group, []).get(group))!.push(item);
      });
    }
    this.animation = null;
    if (this.rootElement.hasAttribute('data-menu-name')) {
      this.name = this.rootElement.getAttribute('data-menu-name') || '';
    }
    this.submenus = [];
    this.itemElements.forEach(item => {
      const root = item.parentElement as HTMLElement;
      if (!root.querySelector(this.settings.selector.list)) {
        return;
      }
      this.submenus.push(new Menu(root, this.settings, true));
    });
    this.submenuTimer = 0;
    if (!this.isSubmenu) {
      Menu.menus.push(this);
    }
    if (this.name && this.isFocusable(this.buttonElement)) {
      Menu.hasOpen[this.name] ||= false;
    }
    this.cleanupFloatingUi = null;
    this.handleOutsidePointerDown = this.handleOutsidePointerDown.bind(this);
    this.handleRootFocusOut = this.handleRootFocusOut.bind(this);
    this.handleButtonPointerOver = this.handleButtonPointerOver.bind(this);
    this.handleButtonClick = this.handleButtonClick.bind(this);
    this.handleButtonKeyDown = this.handleButtonKeyDown.bind(this);
    this.handleListKeyDown = this.handleListKeyDown.bind(this);
    this.handleItemPointerOver = this.handleItemPointerOver.bind(this);
    this.handleCheckboxItemClick = this.handleCheckboxItemClick.bind(this);
    this.handleRadioItemClick = this.handleRadioItemClick.bind(this);
    this.handleSubmenuPointerOver = this.handleSubmenuPointerOver.bind(this);
    this.handleSubmenuPointerLeave = this.handleSubmenuPointerLeave.bind(this);
    this.handleSubmenuClick = this.handleSubmenuClick.bind(this);
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
      this.buttonElement.setAttribute('tabindex', this.isFocusable(this.buttonElement) && !this.isSubmenu ? '0' : '-1');
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
      item.addEventListener('pointerover', this.handleItemPointerOver);
    });
    if (this.checkboxItemElements.length) {
      this.checkboxItemElements.forEach(item => {
        item.addEventListener('click', this.handleCheckboxItemClick);
      });
    }
    if (this.radioItemElements.length) {
      this.radioItemElements.forEach(item => {
        item.addEventListener('click', this.handleRadioItemClick);
      });
    }
    if (this.submenus.length) {
      this.submenus.forEach(submenu => {
        if (!this.isFocusable(submenu.buttonElement)) {
          return;
        }
        submenu.rootElement.addEventListener('pointerover', this.handleSubmenuPointerOver);
        submenu.rootElement.addEventListener('pointerleave', this.handleSubmenuPointerLeave);
        submenu.rootElement.addEventListener('click', this.handleSubmenuClick);
      });
    }
    this.resetTabIndex();
    if (!this.isSubmenu) {
      this.rootElement.setAttribute('data-menu-initialized', '');
    }
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
    if (this.buttonElement) {
      window.requestAnimationFrame(() => {
        this.buttonElement.setAttribute('aria-expanded', String(isOpen));
      });
    }
    if (isOpen) {
      Object.assign(this.listElement.style, {
        display: 'block',
        opacity: '0',
      });
      Menu.menus
        .filter(menu => !menu.rootElement.contains(this.rootElement))
        .forEach(menu => {
          menu.close();
        });
      if (this.buttonElement) {
        this.updateFloatingUi();
      }
    } else if (this.buttonElement && this.rootElement.contains(document.activeElement)) {
      this.buttonElement.focus();
    }
    const opacity = window.getComputedStyle(this.listElement).getPropertyValue('opacity');
    if (this.animation) {
      this.animation.cancel();
    }
    this.animation = this.listElement.animate(
      {
        opacity: isOpen ? [opacity, '1'] : [opacity, '0'],
      },
      {
        duration: this.settings.animation.duration,
        easing: 'ease',
      },
    );
    this.animation.addEventListener('finish', () => {
      this.animation = null;
      if (!isOpen) {
        this.listElement.removeAttribute('data-menu-placement');
        this.listElement.style.setProperty('display', 'none');
      }
      this.listElement.style.removeProperty('opacity');
      if (!isOpen && this.cleanupFloatingUi) {
        this.cleanupFloatingUi();
        this.cleanupFloatingUi = null;
      }
    });
    if (this.name) {
      Menu.hasOpen[this.name] = isOpen;
    }
  }

  private updateFloatingUi(): void {
    const compute = () => {
      computePosition(this.buttonElement, this.listElement, this.settings.floatingUi[!this.isSubmenu ? 'menu' : 'submenu']).then(({ x, y, placement }: { x: number; y: number; placement: Placement }) => {
        Object.assign(this.listElement.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
        this.listElement.setAttribute('data-menu-placement', placement);
        if (this.settings.floatingUi.transformOrigin) {
          let origin: Placement;
          switch (placement) {
            case 'top':
              origin = '50% 100%';
              break;
            case 'top-start':
            case 'right-end':
              origin = '0 100%';
              break;
            case 'top-end':
            case 'left-end':
              origin = '100% 100%';
              break;
            case 'right':
              origin = '0 50%';
              break;
            case 'right-start':
            case 'bottom-start':
              origin = '0 0';
              break;
            case 'bottom':
              origin = '50% 0';
              break;
            case 'bottom-end':
            case 'left-start':
              origin = '100% 0';
              break;
            case 'left':
              origin = '100% 50%';
              break;
          }
          this.listElement.style.setProperty('transform-origin', origin);
        }
      });
    };
    compute();
    if (!this.cleanupFloatingUi) {
      this.cleanupFloatingUi = autoUpdate(this.buttonElement, this.listElement, compute);
    }
  }

  private handleOutsidePointerDown(event: PointerEvent): void {
    if (this.rootElement.contains(event.target as HTMLElement) || !this.buttonElement) {
      return;
    }
    this.close();
  }

  private handleRootFocusOut(event: FocusEvent): void {
    if (!event.relatedTarget || this.rootElement.contains(event.relatedTarget as HTMLElement) || (this.buttonElement && this.buttonElement.getAttribute('aria-expanded') !== 'true')) {
      return;
    }
    if (this.buttonElement) {
      this.close();
    } else {
      this.resetTabIndex();
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
    if (!this.isSubmenu || (event instanceof PointerEvent && event.pointerType !== 'mouse')) {
      this.toggle(!isOpen);
    }
    const focusables = [...this.itemElements].filter(this.isFocusable);
    if (!focusables.length) {
      return;
    }
    if (!isOpen) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusables[0].focus();
        });
      });
    }
  }

  private handleButtonKeyDown(event: KeyboardEvent): void {
    const { key } = event;
    const keys = ['Enter', 'Escape', ' ', 'ArrowUp', ...(this.isSubmenu ? ['ArrowRight'] : []), 'ArrowDown'];
    if (!keys.includes(key)) {
      return;
    }
    event.preventDefault();
    if (!['Escape'].includes(key)) {
      if (this.isSubmenu && key !== 'ArrowRight') {
        return;
      }
      this.open();
      const focusables = [...this.itemElements].filter(this.isFocusable);
      if (!focusables.length) {
        return;
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusables[key !== 'ArrowUp' ? 0 : focusables.length - 1].focus();
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
    const keys = ['Enter', 'Escape', ' ', 'End', 'Home', ...(this.isSubmenu ? ['ArrowLeft'] : []), 'ArrowUp', 'ArrowDown'];
    function isAlpha(value: string): boolean {
      return /^[a-z]$/i.test(value);
    }
    if (!(keys.includes(key) || (shiftKey && key === 'Tab') || (isAlpha(key) && this.itemElementsByInitial[key.toLowerCase()]?.filter(this.isFocusable).length))) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    const active = document.activeElement as HTMLElement;
    if (['Enter', ' '].includes(key)) {
      active.click();
      return;
    }
    if (['Tab', 'Escape'].includes(key) || (this.isSubmenu && key === 'ArrowLeft')) {
      this.close();
      return;
    }
    const focusables = [...this.itemElements].filter(this.isFocusable);
    if (['End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) {
      const currentIndex = focusables.indexOf(active);
      const length = focusables.length;
      let newIndex: number;
      switch (key) {
        case 'End':
          newIndex = length - 1;
          break;
        case 'Home':
          newIndex = 0;
          break;
        case 'ArrowUp':
          newIndex = (currentIndex - 1 + length) % length;
          break;
        case 'ArrowDown':
          newIndex = (currentIndex + 1) % length;
          break;
      }
      if (!this.buttonElement) {
        focusables[currentIndex].setAttribute('tabindex', '-1');
        focusables[newIndex!].setAttribute('tabindex', '0');
      }
      focusables[newIndex!].focus();
      return;
    }
    const focusablesByInitial = this.itemElementsByInitial[key.toLowerCase()].filter(this.isFocusable);
    const index = focusablesByInitial.findIndex(item => focusables.indexOf(item) > focusables.indexOf(active));
    focusablesByInitial[index !== -1 ? index : 0].focus();
  }

  private handleItemPointerOver(event: PointerEvent): void {
    if (this.rootElement.querySelector(':focus-visible')) {
      (event.currentTarget as HTMLElement).focus();
    }
  }

  private handleCheckboxItemClick(event: MouseEvent): void {
    const item = event.currentTarget as HTMLElement;
    item.setAttribute('aria-checked', String(item.getAttribute('aria-checked') !== 'true'));
  }

  private handleRadioItemClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    this.radioItemElementsByGroup.get(target.closest('[role="group"]') || this.rootElement)!.forEach(item => {
      item.setAttribute('aria-checked', String(item === target));
    });
  }

  private handleSubmenuPointerOver(event: PointerEvent): void {
    window.clearTimeout(this.submenuTimer);
    const target = event.currentTarget;
    this.submenuTimer = window.setTimeout(() => {
      this.submenus.forEach(submenu => {
        if (submenu.rootElement === target) {
          submenu.open();
        } else {
          submenu.close();
        }
      });
    }, this.settings.delay);
  }

  private handleSubmenuPointerLeave(event: PointerEvent): void {
    window.clearTimeout(this.submenuTimer);
    if (!this.rootElement.contains(event.relatedTarget as HTMLElement)) {
      return;
    }
    this.submenuTimer = window.setTimeout(() => {
      this.submenus.forEach(submenu => {
        submenu.close();
      });
    }, this.settings.delay);
  }

  private handleSubmenuClick(event: MouseEvent): void {
    this.submenus.forEach(submenu => {
      if (submenu.rootElement === (event.currentTarget as HTMLElement)) {
        submenu.open();
      } else {
        submenu.close();
      }
    });
  }

  open(): void {
    if (!this.buttonElement || this.buttonElement.getAttribute('aria-expanded') === 'true') {
      return;
    }
    this.toggle(true);
  }

  close(): void {
    if (this.submenus.length) {
      window.clearTimeout(this.submenuTimer);
      this.submenus.forEach(submenu => {
        submenu.close();
      });
    }
    if (!this.buttonElement || this.buttonElement.getAttribute('aria-expanded') !== 'true') {
      return;
    }
    this.toggle(false);
  }
}
