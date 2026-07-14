import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Input } from './input'

/**
 * Shared field styling for the public auth forms. Mobile: 16px font (`text-md`)
 * so iOS Safari never auto-zooms on focus, and a 44px tap target (`h-11`).
 * From `sm` up it reverts to the dense desktop scale (`text-sm` / `h-8`).
 */
export const AUTH_INPUT_CLASS = 'h-11 text-md sm:h-8 sm:text-sm'

/**
 * Password field with a show/hide (eye) toggle. Spreads all incoming props —
 * including the `id` / `aria-*` injected by `FormControl`'s Radix `Slot` and the
 * react-hook-form `ref` — straight onto the inner `<Input>` so label association
 * and validation state stay wired to the real input, not the wrapper. The toggle
 * button carries a localized `aria-label`, is `type="button"` so it never submits
 * the form, and stays in the natural tab order (spec: everything reachable by
 * keyboard) — the global `:focus-visible` double-ring (styles.css) is its focus
 * indicator, so we never suppress the outline/ring here.
 */
function PasswordInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const t = useT()
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn(AUTH_INPUT_CLASS, 'pr-10', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
        aria-pressed={visible}
        className={cn(
          'absolute inset-y-0 right-0 flex items-center px-3 text-text-faint',
          'transition-colors duration-fast ease-out hover:text-text',
          // Only shift the icon color on focus — the global `:focus-visible`
          // double-ring paints the actual focus indicator; never suppress it.
          'focus-visible:text-text',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        disabled={props.disabled}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export { PasswordInput }
