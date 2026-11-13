import type { AnchorHTMLAttributes, MouseEvent } from 'react';

export default function NativeLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (!event.defaultPrevented) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('cathoscroll:navigate', { detail: href }));
    }
  }
  return <a {...props} href={href} onClick={navigate} />;
}
