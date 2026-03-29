import { Outlet } from 'react-router';

export default function CategoriesPage() {
  return (
    <div style={{ padding: 'var(--space-4)', color: 'var(--color-text)' }}>
      <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 'var(--text-heading)' }}>
        Categories
      </span>
      <Outlet />
    </div>
  );
}
