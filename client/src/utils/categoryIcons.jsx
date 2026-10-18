import {
  Receipt,
  ForkKnife,
  ShoppingCart,
  Car,
  Bed,
  FilmSlate,
  Lightning,
  House,
  ShoppingBagOpen,
  FirstAidKit,
  Airplane,
  Tag,
} from '@phosphor-icons/react';

const ICONS = {
  general: Receipt,
  food: ForkKnife,
  groceries: ShoppingCart,
  transport: Car,
  lodging: Bed,
  entertainment: FilmSlate,
  utilities: Lightning,
  rent: House,
  shopping: ShoppingBagOpen,
  medical: FirstAidKit,
  travel: Airplane,
  other: Tag,
};

export function CategoryIcon({ categoryId, size = 18, weight = 'bold', ...rest }) {
  const Icon = ICONS[categoryId] || Receipt;
  return <Icon size={size} weight={weight} {...rest} />;
}
