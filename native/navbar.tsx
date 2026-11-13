import { useState } from 'react';
import Link from 'next/link';
import { Menu, Moon, Sun, User, X } from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import { mainNav, siteConfig } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function NativeNavbar({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  return (
    <>
      <header className="bg-bg-primary/95 border-border fixed top-0 right-0 left-0 z-[50] border-b backdrop-blur-md">
        <nav className="container">
          <div className="flex h-16 items-center justify-between">
            <Link
              href="/"
              className="text-text-primary hover:text-accent text-xl font-semibold"
              onClick={() => setOpen(false)}
            >
              {siteConfig.name}
            </Link>
            <div className="hidden items-center gap-1 md:flex">
              {mainNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm font-medium',
                    pathname === item.href
                      ? 'text-accent bg-accent-light'
                      : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                  )}
                >
                  {item.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="hover:bg-bg-secondary rounded-lg p-2"
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <Link
                href="/signin"
                aria-label="Sign In"
                className="hover:bg-bg-secondary rounded-lg p-2"
              >
                <User className="h-5 w-5" />
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="rounded-lg p-2 md:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>
      </header>
      {open && (
        <div className="bg-bg-primary fixed inset-0 z-[45] overflow-y-auto pt-16 md:hidden">
          <nav className="container flex flex-col gap-1 py-6">
            {mainNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'rounded-lg px-4 py-3 font-medium',
                  pathname === item.href
                    ? 'text-accent bg-accent-light'
                    : 'text-text-secondary hover:bg-bg-secondary'
                )}
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => {
                toggleTheme();
                setOpen(false);
              }}
              className="border-border mt-8 rounded-lg border px-4 py-3"
            >
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
            <Link
              href="/signin"
              onClick={() => setOpen(false)}
              className="border-border mt-4 rounded-lg border px-4 py-3 text-center"
            >
              Sign In
            </Link>
          </nav>
        </div>
      )}
    </>
  );
}
