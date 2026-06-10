/** Accessible modal helpers (no native alert/confirm). */

const root = (): HTMLElement => document.getElementById('modal-root')!;

export interface ModalHandle {
  close: () => void;
  body: HTMLElement;
}

export function openModal(title: string, build: (body: HTMLElement, close: () => void) => void): ModalHandle {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', title);
  const h = document.createElement('h3');
  h.textContent = title;
  modal.appendChild(h);
  const body = document.createElement('div');
  modal.appendChild(body);
  backdrop.appendChild(modal);

  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  build(body, close);
  root().appendChild(backdrop);
  return { close, body };
}

export function confirmModal(title: string, message: string, confirmLabel = 'Confirm'): Promise<boolean> {
  return new Promise((resolve) => {
    openModal(title, (body, close) => {
      const p = document.createElement('p');
      p.textContent = message;
      p.style.color = 'var(--text-dim)';
      body.appendChild(p);
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const cancel = document.createElement('button');
      cancel.className = 'tbtn';
      cancel.textContent = 'Cancel';
      cancel.setAttribute('aria-label', 'Cancel');
      cancel.addEventListener('click', () => {
        close();
        resolve(false);
      });
      const ok = document.createElement('button');
      ok.className = 'tbtn tbtn-accent';
      ok.textContent = confirmLabel;
      ok.setAttribute('aria-label', confirmLabel);
      ok.addEventListener('click', () => {
        close();
        resolve(true);
      });
      actions.append(cancel, ok);
      body.appendChild(actions);
      ok.focus();
    });
  });
}

export function noticeModal(title: string, message: string): void {
  openModal(title, (body, close) => {
    const p = document.createElement('p');
    p.textContent = message;
    p.style.color = 'var(--text-dim)';
    body.appendChild(p);
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const ok = document.createElement('button');
    ok.className = 'tbtn tbtn-accent';
    ok.textContent = 'OK';
    ok.setAttribute('aria-label', 'OK');
    ok.addEventListener('click', close);
    actions.appendChild(ok);
    body.appendChild(actions);
    ok.focus();
  });
}

export function promptModal(title: string, label: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    openModal(title, (body, close) => {
      const lab = document.createElement('label');
      lab.textContent = label;
      lab.style.cssText = 'display:block;font-size:0.85rem;color:var(--text-dim);margin-bottom:6px;';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = initial;
      input.className = 'text-input';
      input.style.width = '100%';
      input.setAttribute('aria-label', label);
      body.append(lab, input);
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const cancel = document.createElement('button');
      cancel.className = 'tbtn';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        close();
        resolve(null);
      });
      const ok = document.createElement('button');
      ok.className = 'tbtn tbtn-accent';
      ok.textContent = 'OK';
      ok.addEventListener('click', () => {
        close();
        resolve(input.value);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') ok.click();
      });
      actions.append(cancel, ok);
      body.appendChild(actions);
      input.focus();
      input.select();
    });
  });
}
