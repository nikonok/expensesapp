import { useLocation } from 'react-router';
import CategoryList from '../components/categories/CategoryList';
import TrashedCategories from '../components/categories/TrashedCategories';

export default function CategoriesPage() {
  const location = useLocation();
  const isTrash = location.pathname.endsWith('/trash');

  if (isTrash) {
    return <TrashedCategories />;
  }

  return <CategoryList />;
}
