# S5 — Add Subscription Refactor (una pantalla + acordeones + selector de tarjeta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el Sheet de "Add Subscription" (`SubscriptionForm`) a una sola pantalla con un bloque esencial siempre visible, un selector de tarjeta inline (chips + crear tarjeta nueva sin salir del flujo) y tres acordeones cerrados por defecto que esconden los campos secundarios. Crear una tarjeta nueva desde el formulario la persiste en el vault cifrado (`upsertPaymentMethod`) y la asigna a la suscripción (`paymentMethodId`), apareciendo automáticamente en la página Payment Methods porque ambos consumen el mismo `vaultStore`. Cero cambios de crypto.

**Architecture:**
- `components/subscriptions/SubscriptionForm.tsx` se refactoriza: bloque esencial (serviceName, amount+currency, billingCycle [+cycleDays], nextRenewalDate) siempre visible → `PaymentMethodPicker` → 3 acordeones Base UI Collapsible ("Cuenta y plan", "Credenciales", "Notas y estado"), todos `defaultOpen={false}`.
- `components/subscriptions/PaymentMethodPicker.tsx` (NUEVO): componente controlado que recibe `paymentMethods`, `value` (paymentMethodId seleccionado) y `onChange`; además expone una tarjeta nueva pendiente vía `onNewCardChange(draft | null)`. Renderiza chips horizontales (swatch + brand + ··last4, seleccionables) + chip "+ Nueva tarjeta" que expande un mini-form inline (alias, brand select, last4 4 dígitos, color picker de paleta fija). No persiste nada; solo levanta el estado.
- `SubscriptionForm` mantiene su API actual (`onSubmit`, `onCancel`, `initial`, `paymentMethods`) pero al enviar adjunta un campo efímero `_newPaymentMethod?: NewCardDraft` cuando el usuario creó una tarjeta nueva, igual que ya hace con `_credEmail`/`_credPassword`.
- `app/(vault)/subscriptions/page.tsx` (`handleFormSubmit`) procesa el orden: si hay `_newPaymentMethod`, llama `upsertPaymentMethod` PRIMERO, captura el id generado y lo asigna a `clean.paymentMethodId`; LUEGO `upsertSubscription`. El crypto blob no cambia: ambos upserts ya escriben el mismo `VaultData` cifrado.
- i18n: nuevas claves en `lib/i18n/dict.ts` (bloques `en` y `es`, líneas ~189 y ~430 respectivamente, antes del cierre `} as const;`).

**Tech Stack:** Next.js 16.2.7 (App Router, React 19), TypeScript, Tailwind 4 (`@theme` en `app/globals.css`, sin config file), Base UI `@base-ui/react` (collapsible disponible: `import { Collapsible } from "@base-ui/react/collapsible"` → `Collapsible.Root/Trigger/Panel`), Dexie + Zustand (`vaultStore`), Vitest (`pnpm vitest run`), Playwright (`pnpm exec playwright test`). SIEMPRE `pnpm`.

**Notas de verificación previa (hechas al escribir el plan):**
- El paquete real es `@base-ui/react` (NO `@base-ui-components/react`). `node_modules/@base-ui/react/collapsible/` existe y exporta `Collapsible.Root` (props `defaultOpen?`, `open?`, `onOpenChange?`, `disabled?`), `Collapsible.Trigger`, `Collapsible.Panel` (props `keepMounted?`, `hiddenUntilFound?`). Por tanto SÍ usamos Base UI Collapsible (no hace falta el fallback `details/summary`).
- `vaultStore.upsertPaymentMethod` (lib/store/vault-store.ts:64) genera el id con `uid()` cuando `pm.id` está vacío, PERO la firma actual es `Promise<void>` y no devuelve el id. **Esto obliga a un cambio**: cambiar `upsertPaymentMethod` para que devuelva el id (`Promise<string>`), igual que ya hace `upsertCredential` (línea 78). Es el único modo de asignar el id nuevo a la suscripción de forma fiable.
- `PaymentMethodForm` (components/payment/PaymentMethodForm.tsx) usa `<input type="color">` nativo y exporta `BRANDS`. El mini-form inline del picker reutiliza `BRANDS` pero usa una **paleta fija de swatches** (no el color picker nativo), por requisito del spec §3.4.

---

### Task 1: `upsertPaymentMethod` devuelve el id (TDD)

**Files:**
- `lib/store/vault-store.ts` (líneas 19 y 64-72)
- `tests/store/vault-store.test.ts` (añadir caso al final del `describe`, antes de la línea 43 `});`)

- [ ] Escribir el test que falla. En `tests/store/vault-store.test.ts`, dentro del `describe('vaultStore', ...)`, añadir:
```ts
  it('upsertPaymentMethod returns the generated id for new cards', async () => {
    await vaultStore.getState().createVault('pw');
    const id = await vaultStore.getState().upsertPaymentMethod({
      id: '', label: 'Personal Visa', brand: 'Visa', last4: '4242', color: '#b8c8f0',
    });
    expect(id).toBeTruthy();
    expect(vaultStore.getState().data?.paymentMethods).toHaveLength(1);
    expect(vaultStore.getState().data?.paymentMethods[0].id).toBe(id);
  });
  it('upsertPaymentMethod returns the same id when editing', async () => {
    await vaultStore.getState().createVault('pw');
    const id = await vaultStore.getState().upsertPaymentMethod({
      id: '', label: 'A', brand: 'Visa', last4: '1111', color: '#b8c8f0',
    });
    const again = await vaultStore.getState().upsertPaymentMethod({
      id, label: 'A renamed', brand: 'Visa', last4: '1111', color: '#b8c8f0',
    });
    expect(again).toBe(id);
    expect(vaultStore.getState().data?.paymentMethods).toHaveLength(1);
    expect(vaultStore.getState().data?.paymentMethods[0].label).toBe('A renamed');
  });
```
- [ ] Correr `pnpm vitest run tests/store/vault-store.test.ts` → esperado: FALLA con `TS` error o `expected undefined to be truthy` porque la firma es `Promise<void>`.
- [ ] Cambiar la firma en la interfaz `VaultState` (línea 19) de:
```ts
  upsertPaymentMethod: (pm: PaymentMethod) => Promise<void>;
```
a:
```ts
  upsertPaymentMethod: (pm: PaymentMethod) => Promise<string>;
```
- [ ] Reescribir la implementación (líneas 64-72) para capturar/devolver el id:
```ts
  async upsertPaymentMethod(pm) {
    const data = get().data!;
    const id = pm.id || uid();
    const exists = pm.id && data.paymentMethods.some((p) => p.id === pm.id);
    const next = exists
      ? data.paymentMethods.map((p) => (p.id === pm.id ? { ...pm, id } : p))
      : [...data.paymentMethods, { ...pm, id }];
    set({ data: { ...data, paymentMethods: next } });
    await persist(get);
    return id;
  },
```
- [ ] Correr `pnpm vitest run tests/store/vault-store.test.ts` → esperado: PASA (todos los casos verdes).
- [ ] Verificar que el callsite existente sigue compilando: `pnpm exec tsc --noEmit` → esperado: sin errores nuevos (la página de payment-methods ignora el valor de retorno, lo cual es válido).
- [ ] Commit: `git commit -am "feat(vault): upsertPaymentMethod returns generated id"`

---

### Task 2: Claves i18n nuevas en el diccionario

**Files:**
- `lib/i18n/dict.ts` (bloque `en`: insertar antes de la línea 189 `} as const;` que cierra `en` — concretamente tras `'subform.save'`; bloque `es`: insertar el espejo antes del `} as const;` de `es`)

- [ ] En el objeto `en` (justo después de `'subform.save': 'Save',`, línea 189), añadir las claves nuevas:
```ts
  // ── SubscriptionForm — accordions & card picker (S5) ───────────────────────
  'subform.sectionAccountPlan':   'Account & plan',
  'subform.sectionCredentials':   'Credentials',
  'subform.sectionNotesStatus':   'Notes & status',
  'subform.cardSectionLabel':     'Card',
  'subform.cardNone':             'No card',
  'subform.cardNew':              '+ New card',
  'subform.cardNewLegend':        'New card',
  'subform.cardSelectedAria':     'Selected card',
  'subform.cardChooseAria':       'Choose a card for this subscription',
  'subform.newCardLabel':         'Alias',
  'subform.newCardLabelPlaceholder': 'e.g. Personal Visa',
  'subform.newCardBrand':         'Brand',
  'subform.newCardLast4':         'Last 4 digits',
  'subform.newCardLast4Invalid':  'Must be exactly 4 digits',
  'subform.newCardColor':         'Colour',
  'subform.newCardColorAria':     'Pick a card colour',
  'subform.newCardRemove':        'Discard new card',
```
- [ ] En el objeto `es` (después de `'subform.save': 'Guardar',`, ~línea 430), añadir el espejo exacto:
```ts
  // ── SubscriptionForm — acordeones y selector de tarjeta (S5) ───────────────
  'subform.sectionAccountPlan':   'Cuenta y plan',
  'subform.sectionCredentials':   'Credenciales',
  'subform.sectionNotesStatus':   'Notas y estado',
  'subform.cardSectionLabel':     'Tarjeta',
  'subform.cardNone':             'Sin tarjeta',
  'subform.cardNew':              '+ Nueva tarjeta',
  'subform.cardNewLegend':        'Nueva tarjeta',
  'subform.cardSelectedAria':     'Tarjeta seleccionada',
  'subform.cardChooseAria':       'Elige una tarjeta para esta suscripción',
  'subform.newCardLabel':         'Alias',
  'subform.newCardLabelPlaceholder': 'ej. Visa personal',
  'subform.newCardBrand':         'Marca',
  'subform.newCardLast4':         'Últimos 4 dígitos',
  'subform.newCardLast4Invalid':  'Deben ser exactamente 4 dígitos',
  'subform.newCardColor':         'Color',
  'subform.newCardColorAria':     'Elige un color de tarjeta',
  'subform.newCardRemove':        'Descartar tarjeta nueva',
```
- [ ] Verificar tipado: `pnpm exec tsc --noEmit` → esperado: sin errores (las nuevas claves son `keyof typeof en` automáticamente; `es` debe tener exactamente las mismas claves o `DICT` falla el cast).
- [ ] Commit: `git commit -am "feat(i18n): add subscription card-picker & accordion strings (es/en)"`

---

### Task 3: `PaymentMethodPicker` — componente nuevo (TDD)

**Files:**
- `components/subscriptions/PaymentMethodPicker.tsx` (NUEVO)
- `tests/components/payment-method-picker.test.tsx` (NUEVO)

- [ ] Escribir el test que falla. Crear `tests/components/payment-method-picker.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentMethodPicker, type NewCardDraft } from '@/components/subscriptions/PaymentMethodPicker';
import type { PaymentMethod } from '@/lib/types';

const CARDS: PaymentMethod[] = [
  { id: 'pm1', label: 'Personal Visa', brand: 'Visa', last4: '4242', color: '#b8c8f0' },
  { id: 'pm2', label: 'Amex', brand: 'Amex', last4: '0005', color: '#f0b8d8' },
];

describe('PaymentMethodPicker', () => {
  it('renders one chip per saved card', () => {
    render(
      <PaymentMethodPicker paymentMethods={CARDS} value="" onChange={vi.fn()} onNewCardChange={vi.fn()} />,
    );
    expect(screen.getByRole('radio', { name: /personal visa/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /amex/i })).toBeInTheDocument();
  });

  it('calls onChange with the card id when a chip is clicked', async () => {
    const onChange = vi.fn();
    render(
      <PaymentMethodPicker paymentMethods={CARDS} value="" onChange={onChange} onNewCardChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /personal visa/i }));
    expect(onChange).toHaveBeenCalledWith('pm1');
  });

  it('expands an inline mini-form when "New card" is pressed and emits a draft', async () => {
    const onNewCardChange = vi.fn();
    render(
      <PaymentMethodPicker paymentMethods={CARDS} value="" onChange={vi.fn()} onNewCardChange={onNewCardChange} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /new card/i }));
    const alias = await screen.findByLabelText(/alias/i);
    await userEvent.type(alias, 'Gift card');
    await userEvent.type(screen.getByLabelText(/last 4 digits/i), '9999');
    // last emitted draft has the typed values
    const lastCall = onNewCardChange.mock.calls.at(-1)?.[0] as NewCardDraft;
    expect(lastCall.label).toBe('Gift card');
    expect(lastCall.last4).toBe('9999');
  });

  it('rejects non-digits and caps last4 at 4 chars', async () => {
    const onNewCardChange = vi.fn();
    render(
      <PaymentMethodPicker paymentMethods={[]} value="" onChange={vi.fn()} onNewCardChange={onNewCardChange} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /new card/i }));
    const last4 = screen.getByLabelText(/last 4 digits/i) as HTMLInputElement;
    await userEvent.type(last4, 'a1b2c3d4e5');
    expect(last4.value).toBe('1234');
  });
});
```
- [ ] Correr `pnpm vitest run tests/components/payment-method-picker.test.tsx` → esperado: FALLA (módulo inexistente).
- [ ] Crear `components/subscriptions/PaymentMethodPicker.tsx` con el código completo:
```tsx
"use client";

import * as React from "react";
import type { PaymentMethod } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-t";
import { BRANDS } from "@/components/payment/PaymentMethodForm";

/** Fixed palette of card swatches (no native colour input, per spec §3.4). */
export const CARD_PALETTE = [
  "#b8c8f0", // periwinkle
  "#f0b8d8", // rose
  "#c8b8f0", // lilac
  "#b8f0d8", // mint
  "#f0d8b8", // sand
  "#f0b8b8", // coral
  "#b8e0f0", // sky
  "#d8d8e0", // slate
] as const;

export interface NewCardDraft {
  label: string;
  brand: string;
  last4: string;
  color: string;
}

const EMPTY_DRAFT: NewCardDraft = {
  label: "",
  brand: "Visa",
  last4: "",
  color: CARD_PALETTE[0],
};

export interface PaymentMethodPickerProps {
  paymentMethods: PaymentMethod[];
  /** Currently selected existing-card id ("" = none). */
  value: string;
  onChange: (id: string) => void;
  /** Emits the in-progress new-card draft, or null when the new-card form is closed. */
  onNewCardChange: (draft: NewCardDraft | null) => void;
}

/**
 * PaymentMethodPicker — horizontal chips of saved cards + a "+ New card" chip
 * that expands an inline mini-form. Purely controlled: it never persists.
 * The parent form decides whether to call upsertPaymentMethod on submit.
 */
export function PaymentMethodPicker({
  paymentMethods,
  value,
  onChange,
  onNewCardChange,
}: PaymentMethodPickerProps) {
  const t = useT();
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState<NewCardDraft>(EMPTY_DRAFT);

  function updateDraft(patch: Partial<NewCardDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    onNewCardChange(next);
  }

  function openNewCard() {
    onChange(""); // deselect existing card; the new card wins
    setCreating(true);
    onNewCardChange(draft);
  }

  function closeNewCard() {
    setCreating(false);
    setDraft(EMPTY_DRAFT);
    onNewCardChange(null);
  }

  function selectExisting(id: string) {
    if (creating) closeNewCard();
    onChange(id);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">
        {t("subform.cardSectionLabel")}
      </legend>

      {/* Chips — radiogroup semantics for keyboard + SR */}
      <div
        role="radiogroup"
        aria-label={t("subform.cardChooseAria")}
        className="flex flex-wrap gap-2"
      >
        {/* None */}
        <button
          type="button"
          role="radio"
          aria-checked={value === "" && !creating}
          onClick={() => selectExisting("")}
          className={cn(
            "min-h-[44px] inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
            value === "" && !creating
              ? "border-ring bg-accent text-accent-foreground"
              : "border-input text-muted-foreground hover:bg-accent/50",
          )}
        >
          {t("subform.cardNone")}
        </button>

        {/* Existing cards */}
        {paymentMethods.map((pm) => {
          const selected = value === pm.id && !creating;
          return (
            <button
              key={pm.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${pm.label} ${pm.brand} ${pm.last4}`}
              onClick={() => selectExisting(pm.id)}
              className={cn(
                "min-h-[44px] inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                selected
                  ? "border-ring bg-accent text-accent-foreground"
                  : "border-input hover:bg-accent/50",
              )}
            >
              <span
                className="size-4 shrink-0 rounded-full border border-black/10"
                style={{ background: pm.color }}
                aria-hidden="true"
              />
              <span className="font-medium">{pm.brand}</span>
              <span className="text-muted-foreground">··{pm.last4}</span>
            </button>
          );
        })}

        {/* New card */}
        <button
          type="button"
          role="radio"
          aria-checked={creating}
          onClick={openNewCard}
          className={cn(
            "min-h-[44px] inline-flex items-center gap-2 rounded-full border border-dashed px-3 py-2 text-sm transition-colors",
            creating
              ? "border-ring bg-accent text-accent-foreground"
              : "border-input text-muted-foreground hover:bg-accent/50",
          )}
        >
          {t("subform.cardNew")}
        </button>
      </div>

      {/* Inline mini-form */}
      {creating && (
        <div className="mt-1 flex flex-col gap-3 rounded-xl border border-dashed border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t("subform.cardNewLegend")}
            </span>
            <button
              type="button"
              onClick={closeNewCard}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {t("subform.newCardRemove")}
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newcard-label">{t("subform.newCardLabel")}</Label>
            <Input
              id="newcard-label"
              type="text"
              placeholder={t("subform.newCardLabelPlaceholder")}
              value={draft.label}
              onChange={(e) => updateDraft({ label: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newcard-brand">{t("subform.newCardBrand")}</Label>
              <select
                id="newcard-brand"
                value={draft.brand}
                onChange={(e) => updateDraft({ brand: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {BRANDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newcard-last4">{t("subform.newCardLast4")}</Label>
              <Input
                id="newcard-last4"
                type="text"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="1234"
                value={draft.last4}
                onChange={(e) =>
                  updateDraft({ last4: e.target.value.replace(/\D/g, "").slice(0, 4) })
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="newcard-color-label">{t("subform.newCardColor")}</Label>
            <div
              role="radiogroup"
              aria-labelledby="newcard-color-label"
              className="flex flex-wrap gap-2"
            >
              {CARD_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === c}
                  aria-label={`${t("subform.newCardColorAria")} ${c}`}
                  onClick={() => updateDraft({ color: c })}
                  className={cn(
                    "size-9 rounded-full border-2 transition-transform",
                    draft.color === c ? "border-ring scale-110" : "border-black/10",
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}
```
- [ ] Correr `pnpm vitest run tests/components/payment-method-picker.test.tsx` → esperado: PASA (4 casos verdes).
- [ ] `pnpm exec tsc --noEmit` → esperado: sin errores.
- [ ] Commit: `git commit -am "feat(subscriptions): PaymentMethodPicker (chips + inline new card)"`

---

### Task 4: Refactor de `SubscriptionForm` a una pantalla + acordeones + picker

**Files:**
- `components/subscriptions/SubscriptionForm.tsx` (reescritura del render; conservar estado, validación y construcción del `sub`)

- [ ] Añadir imports al inicio del archivo (tras la línea 10 `import type { DictKey }...`):
```tsx
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { PaymentMethodPicker, type NewCardDraft } from "./PaymentMethodPicker";
```
- [ ] Añadir el estado de la tarjeta nueva junto a los demás `useState` (tras la línea 85 `const [credPassword, ...]`):
```tsx
  // New card drafted inline via PaymentMethodPicker (null = none)
  const [newCard, setNewCard] = React.useState<NewCardDraft | null>(null);
```
- [ ] En `handleSubmit`, antes de `onSubmit(sub)` (línea 133), adjuntar el draft efímero. Reemplazar el bloque del spread efímero (líneas 127-131) por:
```tsx
      // Attach ephemeral data for the page to process
      ...(credEmail || credPassword
        ? { _credEmail: credEmail, _credPassword: credPassword } as unknown as object
        : {}),
      ...(newCard && newCard.label.trim() && /^\d{4}$/.test(newCard.last4)
        ? { _newPaymentMethod: newCard } as unknown as object
        : {}),
```
- [ ] Añadir un helper `AccordionSection` justo antes de la función `SubscriptionForm` (tras `ErrorMsg`, línea 58):
```tsx
function AccordionSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible.Root defaultOpen={false} className="rounded-xl border border-border">
      <Collapsible.Trigger
        className="group flex min-h-[44px] w-full items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-xl"
      >
        {title}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180"
        />
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden">
        <div className="flex flex-col gap-4 px-3.5 pb-3.5 pt-1">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
```
- [ ] Reescribir el cuerpo del `<form>` (líneas 143-377) en este orden, manteniendo cada `FieldGroup`/`Input`/`select` exactamente como están hoy pero reorganizados:
  1. **Bloque esencial siempre visible** (sin acordeón): serviceName · grid[amount+currency] · grid[billingCycle (+cycleDays si custom)] · nextRenewalDate. (Mover aquí tal cual los FieldGroups de las líneas 144-250.)
  2. **PaymentMethodPicker** (reemplaza el `<select>` de payment method de las líneas 308-325):
```tsx
      <PaymentMethodPicker
        paymentMethods={paymentMethods}
        value={paymentMethodId}
        onChange={setPaymentMethodId}
        onNewCardChange={setNewCard}
      />
```
  3. **Acordeón "Cuenta y plan"** → accountEmail (285-295), plan (297-306), url (327-336):
```tsx
      <AccordionSection title={t('subform.sectionAccountPlan')}>
        {/* accountEmail FieldGroup */}
        {/* plan FieldGroup */}
        {/* url FieldGroup */}
      </AccordionSection>
```
  4. **Acordeón "Credenciales"** → el contenido del `<fieldset>` credencial actual (355-376), sin el `<fieldset>`/`<legend>` (el acordeón ya aporta el título):
```tsx
      <AccordionSection title={t('subform.sectionCredentials')}>
        {/* credEmail FieldGroup */}
        {/* credPassword FieldGroup */}
      </AccordionSection>
```
  5. **Acordeón "Notas y estado"** → grid[status+category] (252-283) + notes (338-348):
```tsx
      <AccordionSection title={t('subform.sectionNotesStatus')}>
        {/* status + category grid */}
        {/* notes FieldGroup */}
      </AccordionSection>
```
  6. **Acciones** (Cancel/Save) sin cambios (379-387).
- [ ] Confirmar que `amount` mantiene `inputMode="decimal"` (ya lo tiene, línea 174) y `nextRenewalDate` sigue siendo `type="date"` (línea 242). No tocar la lógica de `validate()`.
- [ ] Correr el test de componente existente: `pnpm vitest run tests/components/subscription-form.test.tsx` → esperado: PASA (los labels "Service name", "Amount", "Next renewal" siguen visibles porque están en el bloque esencial, fuera de acordeones).
- [ ] `pnpm exec tsc --noEmit` → esperado: sin errores.
- [ ] Commit: `git commit -am "feat(subscriptions): single-screen form with accordions + card picker"`

---

### Task 5: Página de suscripciones procesa la tarjeta nueva (orden upsert) (TDD)

**Files:**
- `app/(vault)/subscriptions/page.tsx` (tipo `SubWithCreds` línea 20, `handleFormSubmit` líneas 58-81)
- `tests/store/subscription-with-new-card.test.ts` (NUEVO — testea la lógica de guardado contra el store real)

- [ ] Escribir el test que falla. Crear `tests/store/subscription-with-new-card.test.ts`. Como `handleFormSubmit` vive en un componente, extraemos la lógica de orden a una función pura testeable y la testeamos contra el `vaultStore` real:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/database';
import { vaultStore } from '@/lib/store/vault-store';
import { saveSubscriptionWithDraftCard } from '@/lib/services/save-subscription';
import type { Subscription } from '@/lib/types';

beforeEach(async () => { await db.delete(); await db.open(); vaultStore.getState().reset(); });

const baseSub: Subscription = {
  id: '', serviceName: 'Netflix', category: '', amount: 15, currency: 'USD',
  billingCycle: 'monthly', nextRenewalDate: '2026-07-01', status: 'active',
  createdAt: '', updatedAt: '',
};

describe('saveSubscriptionWithDraftCard', () => {
  it('creates the payment method FIRST, then assigns its id to the subscription', async () => {
    await vaultStore.getState().createVault('pw');
    const store = vaultStore.getState();
    await saveSubscriptionWithDraftCard(store, baseSub, undefined, {
      label: 'Gift Visa', brand: 'Visa', last4: '4242', color: '#b8c8f0',
    });
    const { paymentMethods, subscriptions } = vaultStore.getState().data!;
    expect(paymentMethods).toHaveLength(1);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].paymentMethodId).toBe(paymentMethods[0].id);
    expect(paymentMethods[0].id).toBeTruthy();
  });

  it('creates no card when draft is undefined', async () => {
    await vaultStore.getState().createVault('pw');
    await saveSubscriptionWithDraftCard(vaultStore.getState(), baseSub, undefined, undefined);
    expect(vaultStore.getState().data!.paymentMethods).toHaveLength(0);
    expect(vaultStore.getState().data!.subscriptions[0].paymentMethodId).toBeUndefined();
  });

  it('keeps an explicitly selected existing card id when no draft', async () => {
    await vaultStore.getState().createVault('pw');
    const pmId = await vaultStore.getState().upsertPaymentMethod({
      id: '', label: 'Existing', brand: 'Visa', last4: '0001', color: '#b8c8f0',
    });
    await saveSubscriptionWithDraftCard(
      vaultStore.getState(), { ...baseSub, paymentMethodId: pmId }, undefined, undefined,
    );
    expect(vaultStore.getState().data!.subscriptions[0].paymentMethodId).toBe(pmId);
    expect(vaultStore.getState().data!.paymentMethods).toHaveLength(1);
  });
});
```
- [ ] Correr `pnpm vitest run tests/store/subscription-with-new-card.test.ts` → esperado: FALLA (módulo `@/lib/services/save-subscription` inexistente).
- [ ] Crear `lib/services/save-subscription.ts` con la lógica pura:
```ts
import type { Subscription, Credential, PaymentMethod } from "@/lib/types";

export interface DraftCard {
  label: string;
  brand: string;
  last4: string;
  color: string;
}

/** Minimal slice of the vault store this helper needs (keeps it unit-testable). */
export interface VaultActions {
  upsertCredential: (c: Credential) => Promise<string>;
  upsertPaymentMethod: (pm: PaymentMethod) => Promise<string>;
  upsertSubscription: (sub: Subscription) => Promise<void>;
}

interface DraftCreds {
  email?: string;
  password?: string;
}

/**
 * Persists a subscription that may carry an inline-created credential and/or
 * an inline-created payment method. ORDER MATTERS:
 *   1. credential (if any)  → assign credentialId
 *   2. payment method (if any) → assign the NEW paymentMethodId
 *   3. subscription
 * All three write the same encrypted VaultData blob — zero crypto changes.
 */
export async function saveSubscriptionWithDraftCard(
  actions: VaultActions,
  sub: Subscription,
  creds: DraftCreds | undefined,
  draftCard: DraftCard | undefined,
): Promise<void> {
  const next: Subscription = { ...sub };

  if (creds && (creds.email || creds.password)) {
    next.credentialId = await actions.upsertCredential({
      id: next.credentialId ?? "",
      username: creds.email ?? "",
      password: creds.password ?? "",
    });
  }

  if (draftCard && draftCard.label.trim() && /^\d{4}$/.test(draftCard.last4)) {
    // Create the card FIRST, capture its generated id, then link it.
    next.paymentMethodId = await actions.upsertPaymentMethod({
      id: "",
      label: draftCard.label.trim(),
      brand: draftCard.brand,
      last4: draftCard.last4,
      color: draftCard.color,
    });
  }

  await actions.upsertSubscription(next);
}
```
- [ ] Correr `pnpm vitest run tests/store/subscription-with-new-card.test.ts` → esperado: PASA (3 casos verdes).
- [ ] Refactorizar `app/(vault)/subscriptions/page.tsx` para usar el helper. Cambiar el tipo `SubWithCreds` (línea 20):
```tsx
type SubWithCreds = Subscription & {
  _credEmail?: string;
  _credPassword?: string;
  _newPaymentMethod?: { label: string; brand: string; last4: string; color: string };
};
```
- [ ] Añadir el import (tras la línea 9):
```tsx
import { saveSubscriptionWithDraftCard } from "@/lib/services/save-subscription";
```
- [ ] Añadir el selector de `upsertPaymentMethod` (tras la línea 30):
```tsx
  const upsertPaymentMethod = useStore(vaultStore, (s) => s.upsertPaymentMethod);
```
- [ ] Reemplazar el cuerpo de `handleFormSubmit` (líneas 58-81) por:
```tsx
  async function handleFormSubmit(raw: Subscription) {
    const sub = raw as SubWithCreds;
    const credEmail = sub._credEmail;
    const credPassword = sub._credPassword;
    const draftCard = sub._newPaymentMethod;

    // Strip ephemeral fields
    const clean: Subscription = { ...sub };
    delete (clean as SubWithCreds)._credEmail;
    delete (clean as SubWithCreds)._credPassword;
    delete (clean as SubWithCreds)._newPaymentMethod;

    await saveSubscriptionWithDraftCard(
      { upsertCredential, upsertPaymentMethod, upsertSubscription },
      clean,
      { email: credEmail, password: credPassword },
      draftCard,
    );

    setFormOpen(false);
    setEditSub(undefined);
  }
```
- [ ] Correr toda la suite unit: `pnpm vitest run` → esperado: TODO verde (incluidos los nuevos y los existentes de store/form).
- [ ] `pnpm exec tsc --noEmit` → esperado: sin errores.
- [ ] Commit: `git commit -am "feat(subscriptions): persist inline new card before subscription (correct upsert order)"`

---

### Task 6: E2E — crear suscripción con tarjeta nueva → verla en Payment Methods

**Files:**
- `e2e/orbit.spec.ts` (añadir un test nuevo al final; reutilizar helpers `createVault`, `gotoSubscriptions`)

- [ ] Añadir, tras el último test (línea 226), un helper de navegación a payment-methods y el test del flujo:
```ts
// ── Test 4: add subscription with a NEW card → card appears in Payment Methods ──

async function gotoCards(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: /^(cards|tarjetas)$/i }).filter({ visible: true }).click();
  await page.waitForURL('**/payment-methods', { timeout: 10_000 });
}

test('create subscription with a new inline card, then see it in Payment Methods', async ({ page }) => {
  await createVault(page);
  await gotoSubscriptions(page);

  const addBtn = page.getByRole('button', { name: /add subscription/i }).or(
    page.getByRole('button', { name: /^add$/i }),
  );
  await addBtn.first().click();

  // Essential block
  await page.getByLabel('Service name').fill('Spotify');
  await page.getByLabel('Amount').fill('9.99');
  await page.getByLabel('Next renewal').fill('2026-12-31');

  // Card picker: open the inline new-card form
  await page.getByRole('radio', { name: /new card/i }).click();
  await page.getByLabel(/alias/i).fill('Gift Visa');
  await page.getByLabel(/last 4 digits/i).fill('4242');

  await page.getByRole('button', { name: /^save$/i }).click();

  // Subscription appears
  await expect(page.getByRole('button', { name: /spotify/i })).toBeVisible({ timeout: 10_000 });

  // The new card now lives in Payment Methods (same encrypted store)
  await gotoCards(page);
  await expect(page.getByText(/gift visa/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/4242/)).toBeVisible();
});
```
- [ ] Verificar que el nav link a payment-methods coincide con el label real. Si el label en `nav-items.ts` no es "Cards"/"Tarjetas", ajustar el regex de `gotoCards` al label real (revisar `components/nav/nav-items.ts` y `dict.ts` clave `nav.cards`). (Confirmado: `dict.ts` define `nav.cards: 'Cards'`/`'Tarjetas'`.)
- [ ] Construir y correr el E2E contra build de prod (como hace la suite actual): `pnpm build && pnpm exec playwright test e2e/orbit.spec.ts` → esperado: los 4 tests pasan.
- [ ] Si falla por el selector del FAB/Add o por animación de Sheet, aplicar el patrón `.filter({ visible: true })` y esperas ya usados en el archivo (no cambiar la lógica de la app).
- [ ] Commit: `git commit -am "test(e2e): create subscription with inline new card surfaces in payment methods"`

---

### Task 7: Gates y cierre

**Files:**
- (verificación; sin código nuevo salvo fixes que surjan de los gates)

- [ ] `pnpm vitest run` → esperado: toda la suite verde. Pegar el resumen de Vitest como evidencia.
- [ ] `pnpm build && pnpm exec playwright test` → esperado: toda la suite E2E verde.
- [ ] Lanzar `/impeccable audit` sobre el Sheet de Add Subscription: abrir el dev/preview, navegar a /subscriptions, abrir el formulario y capturar screenshot con Playwright a 390×844 (móvil) y 1280 (desktop). Verificar: acordeones cerrados por defecto, targets ≥44px (chips y triggers), foco visible, contraste de swatches, sin layout shift al expandir.
- [ ] `/code-review` sobre el diff completo de la sesión.
- [ ] Pasar el diff de los `.tsx` sustanciales (`SubscriptionForm.tsx`, `PaymentMethodPicker.tsx`, `subscriptions/page.tsx`) a `typescript-reviewer`. Atender hallazgos (especialmente tipos de los campos efímeros y el `as unknown as object`).
- [ ] Verificación manual rápida (superpowers:verification-before-completion): crear una suscripción con tarjeta nueva en el navegador, confirmar que aparece en Payment Methods Y que la suscripción quedó vinculada (abrir su detalle). Confirmar que bloquear/desbloquear el vault conserva ambas (round-trip cifrado).
- [ ] Commit final si hubo fixes: `git commit -am "fix(s5): address review feedback"`. NO mergear; dejar la rama lista.
- [ ] `/compact`.
