import { Middleware, Placement, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';

type MenuOptions = {
  animation: {
    duration: number;
  };
  delay: number;
  popover: {
    menu: Partial<MenuPopoverOptions>;
    submenu: Partial<MenuPopoverOptions>;
    transformOrigin: boolean;
  };
  selector: {
    checkboxItem: string;
    group: string;
    item: string;
    list: string;
    radioItem: string;
    trigger: string;
  };
};

type MenuPopoverOptions = {
  middleware: Middleware[];
  placement: Placement;
};

export class Menu {
  private static menus: Menu[] = [];
  protected rootElement!: HTMLElement;
  private defaults!: MenuOptions;
  private settings!: MenuOptions;
  private isSubmenu!: boolean;
  protected triggerElement!: HTMLElement;
  protected listElement!: HTMLElement;
  private itemElements!: HTMLElement[];
  private itemElementsByInitial!: Record<string, HTMLElement[]>;
  private checkboxItemElements!: HTMLElement[];
  private radioItemElements!: HTMLElement[];
  private radioItemElementsByGroup!: Map<HTMLElement, HTMLElement[]>;
  private animation!: Animation | null;
  private submenus!: Menu[];
  private submenuTimer!: number;
  private cleanupPopover!: Function | null;

  constructor(root: HTMLElement, options?: Partial<MenuOptions>, submenu = false) {
    if (!root) {
      return;
    }
    this.rootElement = root;
    this.defaults = {
      animation: {
        duration: 300,
      },
      delay: 300,
      popover: {
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
      selector: {
        checkboxItem: '[role="menuitemcheckbox"]',
        group: '[role="group"]',
        item: '[role^="menuitem"]',
        list: '[role="menu"]',
        radioItem: '[role="menuitemradio"]',
        trigger: '[data-menu-trigger]',
      },
    };
    this.settings = {
      ...this.defaults,
      ...options,
      animation: { ...this.defaults.animation, ...options?.animation },
      popover: {
        ...this.defaults.popover,
        ...options?.popover,
        menu: { ...this.defaults.popover.menu, ...options?.popover?.menu },
        submenu: { ...this.defaults.popover.submenu, ...options?.popover?.submenu },
      },
      selector: { ...this.defaults.selector, ...options?.selector },
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.animation.duration = 0;
    }
    this.isSubmenu = submenu;
    this.triggerElement = this.rootElement.querySelector(this.settings.selector[!this.isSubmenu ? 'trigger' : 'item']) as HTMLElement;
    this.listElement = this.rootElement.querySelector(this.settings.selector.list) as HTMLElement;
    this.itemElements = [...this.listElement.querySelectorAll(`${this.settings.selector.item}:not(:scope ${this.settings.selector.list} *)`)] as HTMLElement[];
    this.itemElementsByInitial = {};
    if (this.itemElements.length) {
      this.itemElements.forEach(item => {
        const initial = item.textContent!.trim().charAt(0).toLowerCase();
        if (/\S/.test(initial)) {
          item.setAttribute('aria-keyshortcuts', initial);
          (this.itemElementsByInitial[initial] ||= []).push(item);
        }
      });
    }
    this.checkboxItemElements = this.itemElements.filter(item => item.getAttribute('role') === 'menuitemcheckbox');
    this.radioItemElements = this.itemElements.filter(item => item.getAttribute('role') === 'menuitemradio');
    this.radioItemElementsByGroup = new Map();
    if (this.radioItemElements.length) {
      this.radioItemElements.forEach(item => {
        let group = item.closest(this.settings.selector.group) as HTMLElement;
        if (!group || !this.rootElement.contains(group)) {
          group = this.rootElement;
        }
        (this.radioItemElementsByGroup.get(group) || this.radioItemElementsByGroup.set(group, []).get(group))!.push(item);
      });
    }
    this.animation = null;
    this.submenus = [];
    this.submenuTimer = 0;
    this.cleanupPopover = null;
    this.handleOutsidePointerDown = this.handleOutsidePointerDown.bind(this);
    this.handleRootFocusIn = this.handleRootFocusIn.bind(this);
    this.handleRootFocusOut = this.handleRootFocusOut.bind(this);
    this.handleTriggerClick = this.handleTriggerClick.bind(this);
    this.handleTriggerKeyDown = this.handleTriggerKeyDown.bind(this);
    this.handleListKeyDown = this.handleListKeyDown.bind(this);
    this.handleItemBlur = this.handleItemBlur.bind(this);
    this.handleItemFocus = this.handleItemFocus.bind(this);
    this.handleItemPointerOut = this.handleItemPointerOut.bind(this);
    this.handleItemPointerOver = this.handleItemPointerOver.bind(this);
    this.handleCheckboxItemClick = this.handleCheckboxItemClick.bind(this);
    this.handleRadioItemClick = this.handleRadioItemClick.bind(this);
    this.initialize();
  }

  private initialize(): void {
    if (!this.listElement || !this.itemElements.length) {
      return;
    }
    document.addEventListener('pointerdown', this.handleOutsidePointerDown);
    this.rootElement.addEventListener('focusin', this.handleRootFocusIn);
    this.rootElement.addEventListener('focusout', this.handleRootFocusOut);
    if (this.triggerElement) {
      const id = Math.random().toString(36).slice(-8);
      this.triggerElement.setAttribute('aria-controls', (this.listElement.id ||= `menu-list-${id}`));
      this.triggerElement.setAttribute('aria-expanded', 'false');
      this.triggerElement.setAttribute('aria-haspopup', 'true');
      this.triggerElement.id ||= `menu-trigger-${id}`;
      this.triggerElement.setAttribute('tabindex', this.isFocusable(this.triggerElement) && !this.isSubmenu ? '0' : '-1');
      if (!this.isFocusable(this.triggerElement)) {
        this.triggerElement.style.setProperty('pointer-events', 'none');
      }
      this.triggerElement.addEventListener('click', this.handleTriggerClick);
      this.triggerElement.addEventListener('keydown', this.handleTriggerKeyDown);
      this.listElement.setAttribute('aria-labelledby', `${this.listElement.getAttribute('aria-labelledby') || ''} ${this.triggerElement.id}`.trim());
    }
    this.listElement.setAttribute('role', 'menu');
    this.listElement.addEventListener('keydown', this.handleListKeyDown);
    this.itemElements.forEach(item => {
      const root = item.parentElement!;
      if (root.querySelector(this.settings.selector.list)) {
        this.submenus.push(new Menu(root, this.settings, true));
      }
      if ([this.checkboxItemElements, this.radioItemElements].every(list => !list.includes(item))) {
        item.setAttribute('role', 'menuitem');
      }
      item.addEventListener('blur', this.handleItemBlur);
      item.addEventListener('focus', this.handleItemFocus);
      item.addEventListener('pointerout', this.handleItemPointerOut);
      item.addEventListener('pointerover', this.handleItemPointerOver);
    });
    if (this.checkboxItemElements.length) {
      this.checkboxItemElements.forEach(item => {
        item.setAttribute('role', 'menuitemcheckbox');
        item.addEventListener('click', this.handleCheckboxItemClick);
      });
    }
    if (this.radioItemElements.length) {
      this.radioItemElements.forEach(item => {
        item.setAttribute('role', 'menuitemradio');
        item.addEventListener('click', this.handleRadioItemClick);
      });
    }
    this.resetTabIndex();
    if (!this.isSubmenu) {
      this.rootElement.setAttribute('data-menu-initialized', '');
    }
    Menu.menus.push(this);
  }

  private getActiveElement(): HTMLElement | null {
    let active: Element | null = document.activeElement;
    while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active instanceof HTMLElement ? active : null;
  }

  private isFocusable(element: HTMLElement): boolean {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }

  private resetTabIndex(force = false): void {
    if (this.triggerElement || force) {
      this.itemElements.forEach(item => {
        item.setAttribute('tabindex', '-1');
      });
    } else {
      const first = this.itemElements.find(item => this.isFocusable(item));
      this.itemElements.forEach(item => {
        item.setAttribute('tabindex', item === first ? '0' : '-1');
      });
    }
  }

  private toggle(open: boolean): void {
    if (open.toString() === this.triggerElement?.getAttribute('aria-expanded')) {
      return;
    }
    if (this.triggerElement) {
      window.requestAnimationFrame(() => {
        this.triggerElement.setAttribute('aria-expanded', String(open));
      });
    }
    if (open) {
      Menu.menus.filter(menu => !menu.rootElement.contains(this.rootElement)).forEach(menu => menu.close());
      Object.assign(this.listElement.style, {
        display: 'block',
        opacity: '0',
      });
      if (this.triggerElement) {
        this.updatePopover();
      }
      const focusable = this.itemElements.find(this.isFocusable);
      if (focusable) {
        focusable.focus();
      }
    } else {
      if (this.submenus.length) {
        window.clearTimeout(this.submenuTimer);
        this.submenus.forEach(submenu => submenu.close());
      }
      if (this.triggerElement && this.rootElement.contains(this.getActiveElement())) {
        this.triggerElement.focus();
      }
    }
    if (!this.triggerElement) {
      return;
    }
    const opacity = window.getComputedStyle(this.listElement).getPropertyValue('opacity');
    if (this.animation) {
      this.animation.cancel();
    }
    this.animation = this.listElement.animate(
      {
        opacity: open ? [opacity, '1'] : [opacity, '0'],
      },
      {
        duration: this.settings.animation.duration,
        easing: 'ease',
      },
    );
    this.animation.addEventListener('finish', () => {
      this.animation = null;
      if (!open) {
        this.listElement.removeAttribute('data-menu-placement');
        this.listElement.style.setProperty('display', 'none');
        if (this.settings.popover.transformOrigin) {
          this.listElement.style.removeProperty('transform-origin');
        }
      }
      this.listElement.style.removeProperty('opacity');
    });
    if (!open && this.cleanupPopover) {
      this.cleanupPopover();
      this.cleanupPopover = null;
    }
  }

  private updatePopover(): void {
    const compute = () => {
      computePosition(this.triggerElement, this.listElement, this.settings.popover[!this.isSubmenu ? 'menu' : 'submenu']).then(({ x, y, placement }) => {
        Object.assign(this.listElement.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
        this.listElement.setAttribute('data-menu-placement', placement);
        if (this.settings.popover.transformOrigin) {
          this.listElement.style.setProperty(
            'transform-origin',
            {
              top: '50% 100%',
              'top-start': '0 100%',
              'top-end': '100% 100%',
              right: '0 50%',
              'right-start': '0 0',
              'right-end': '0 100%',
              bottom: '50% 0',
              'bottom-start': '0 0',
              'bottom-end': '100% 0',
              left: '100% 50%',
              'left-start': '100% 0',
              'left-end': '100% 100%',
            }[placement],
          );
        }
      });
    };
    compute();
    if (!this.cleanupPopover) {
      this.cleanupPopover = autoUpdate(this.triggerElement, this.listElement, compute);
    }
  }

  private handleOutsidePointerDown(event: PointerEvent): void {
    if (this.rootElement.contains(event.target as HTMLElement) || !this.triggerElement) {
      return;
    }
    this.resetTabIndex();
    this.close();
  }

  private handleRootFocusIn(event: FocusEvent): void {
    if (this.rootElement.contains(event.relatedTarget as HTMLElement) && this.rootElement.contains(this.getActiveElement())) {
      return;
    }
    this.resetTabIndex(true);
  }

  private handleRootFocusOut(event: FocusEvent): void {
    if (this.rootElement.contains(event.relatedTarget as HTMLElement)) {
      return;
    }
    this.resetTabIndex();
    this.close();
  }

  private handleTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    if (!this.isSubmenu) {
      const open = this.triggerElement.getAttribute('aria-expanded') === 'true';
      if (!this.isSubmenu || (event instanceof PointerEvent && event.pointerType !== 'mouse')) {
        this.toggle(!open);
      }
    } else {
      this.toggle(this.triggerElement === event.currentTarget);
    }
  }

  private handleTriggerKeyDown(event: KeyboardEvent): void {
    const { key } = event;
    if (!['Enter', ' ', ...(!this.isSubmenu ? ['ArrowUp', 'ArrowDown'] : ['ArrowRight'])].includes(key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.open();
    const focusables = this.itemElements.filter(this.isFocusable);
    const length = focusables.length;
    if (!length) {
      return;
    }
    let index!: number;
    switch (key) {
      case 'Enter':
      case ' ':
        this.triggerElement.click();
        return;
      case 'ArrowUp':
        index = length - 1;
        break;
      case 'ArrowRight':
        return;
      case 'ArrowDown':
        index = 0;
        break;
    }
    focusables[index].focus();
  }

  private handleListKeyDown(event: KeyboardEvent): void {
    const { shiftKey, key } = event;
    if (!this.triggerElement && shiftKey && key === 'Tab') {
      return;
    }
    const keys = ['Tab', 'Enter', 'Escape', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'];
    if (this.isSubmenu) {
      keys.push('ArrowLeft');
    }
    // prettier-ignore
    if (
      !keys.includes(key)
      && !(shiftKey && key === 'Tab')
      && !(/^\S$/i.test(key) && this.itemElementsByInitial[key.toLowerCase()]?.find(this.isFocusable))
    ) {
      return;
    }
    if (!shiftKey) {
      if (key === 'Tab') {
        return;
      }
      event.stopPropagation();
    }
    event.preventDefault();
    const focusables = this.itemElements.filter(this.isFocusable);
    const length = focusables.length;
    const active = this.getActiveElement();
    const current = active instanceof HTMLElement ? active : null;
    if (!current) {
      return;
    }
    const currentIndex = focusables.indexOf(current);
    if (currentIndex === -1) {
      return;
    }
    let newIndex: number;
    let targetFocusables = focusables;
    switch (key) {
      case 'Tab':
      case 'Escape':
      case 'ArrowLeft':
        this.close();
        return;
      case 'Enter':
      case ' ':
        current.click();
        return;
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
      default:
        targetFocusables = this.itemElementsByInitial[key.toLowerCase()].filter(this.isFocusable);
        const foundIndex = targetFocusables.findIndex(focusable => focusables.indexOf(focusable) > currentIndex);
        newIndex = foundIndex !== -1 ? foundIndex : 0;
    }
    const focusable = targetFocusables[newIndex];
    focusable.focus();
  }

  private handleItemBlur(event: FocusEvent): void {
    (event.currentTarget as HTMLElement).setAttribute('tabindex', '-1');
  }

  private handleItemFocus(event: FocusEvent): void {
    (event.currentTarget as HTMLElement).setAttribute('tabindex', '0');
  }

  private handleItemPointerOut(): void {
    window.clearTimeout(this.submenuTimer);
  }

  private handleItemPointerOver(event: PointerEvent): void {
    window.clearTimeout(this.submenuTimer);
    const item = event.currentTarget as HTMLElement;
    this.submenuTimer = window.setTimeout(() => {
      if (this.submenus.length) {
        this.submenus.forEach(submenu => submenu.toggle(submenu.triggerElement === item));
      }
      item.setAttribute('tabindex', '0');
      item.focus();
    }, this.settings.delay);
  }

  private handleCheckboxItemClick(event: MouseEvent): void {
    const item = event.currentTarget as HTMLElement;
    item.setAttribute('aria-checked', String(item.getAttribute('aria-checked') === 'false'));
  }

  private handleRadioItemClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    this.radioItemElementsByGroup.get(target.closest(this.settings.selector.group) || this.rootElement)!.forEach(item => {
      item.setAttribute('aria-checked', String(item === target));
    });
  }

  open(): void {
    this.toggle(true);
  }

  close(): void {
    this.toggle(false);
  }
}
