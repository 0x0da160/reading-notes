// アイコンだけのボタン。名前は aria-label で示し、マウスでは title で補う（アイコン自体は読み上げない）。
import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  label: string;
  icon: LucideIcon;
}

export function IconButton({ label, icon: Icon, className, ...rest }: Props) {
  return (
    <button type="button" className={`btn btn-icon ${className ?? ''}`} aria-label={label} title={label} {...rest}>
      <Icon size={22} strokeWidth={1.75} aria-hidden="true" focusable="false" />
    </button>
  );
}

/** アイコンと短い文字を並べるボタンの中身 */
export function IconLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <>
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" focusable="false" />
      <span>{children}</span>
    </>
  );
}
