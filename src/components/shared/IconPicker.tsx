import { useState } from "react";
import {
  Wallet,
  CreditCard,
  Home,
  Car,
  Utensils,
  ShoppingCart,
  Heart,
  Plane,
  Coffee,
  Book,
  Music,
  Gamepad2,
  Briefcase,
  Laptop,
  Phone,
  Gift,
  Scissors,
  Baby,
  Dumbbell,
  Cat,
  Shirt,
  Pill,
  GraduationCap,
  Building,
  Trees,
  Sun,
  Star,
  Flag,
  Globe,
  Leaf,
  Zap,
  Shield,
  Wrench,
  Map,
  Camera,
  Bitcoin,
  BarChart2,
  PiggyBank,
  Fuel,
  ShoppingBag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ICON_LIST } from "../../utils/constants";

const ICON_MAP: Record<string, LucideIcon> = {
  wallet: Wallet,
  "credit-card": CreditCard,
  home: Home,
  car: Car,
  utensils: Utensils,
  "shopping-cart": ShoppingCart,
  heart: Heart,
  plane: Plane,
  coffee: Coffee,
  book: Book,
  music: Music,
  "gamepad-2": Gamepad2,
  briefcase: Briefcase,
  laptop: Laptop,
  phone: Phone,
  gift: Gift,
  scissors: Scissors,
  baby: Baby,
  dumbbell: Dumbbell,
  cat: Cat,
  shirt: Shirt,
  pill: Pill,
  "graduation-cap": GraduationCap,
  building: Building,
  tree: Trees,
  sun: Sun,
  star: Star,
  flag: Flag,
  globe: Globe,
  leaf: Leaf,
  zap: Zap,
  shield: Shield,
  wrench: Wrench,
  map: Map,
  camera: Camera,
  bitcoin: Bitcoin,
  "bar-chart-2": BarChart2,
  "piggy-bank": PiggyBank,
  fuel: Fuel,
  "shopping-bag": ShoppingBag,
};

export function getLucideIcon(name: string): LucideIcon | null {
  return ICON_MAP[name] ?? null;
}

interface IconPickerProps {
  value: string;
  onChange: (v: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [emoji, setEmoji] = useState(() => (ICON_LIST.includes(value) ? "" : value));

  const isEmoji = !ICON_LIST.includes(value) && value !== "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div
        role="radiogroup"
        aria-label="Icon"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))",
          gap: "var(--space-2)",
        }}
      >
        {ICON_LIST.map((iconName) => {
          const Icon = ICON_MAP[iconName];
          if (!Icon) return null;
          const isSelected = value === iconName;
          return (
            <button
              key={iconName}
              role="radio"
              aria-checked={isSelected}
              aria-label={iconName}
              onClick={() => {
                onChange(iconName);
                setEmoji("");
              }}
              style={{
                width: "44px",
                height: "44px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isSelected ? "var(--color-primary-dim)" : "var(--color-surface)",
                border: isSelected
                  ? "1px solid var(--color-primary)"
                  : "1px solid var(--color-border)",
                borderRadius: "var(--radius-icon)",
                cursor: "pointer",
                color: isSelected ? "var(--color-primary)" : "var(--color-text-secondary)",
                transition: "background 100ms ease-out, border-color 100ms ease-out",
              }}
            >
              <Icon size={20} strokeWidth={1.5} />
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <label
          htmlFor="icon-emoji-input"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-text-secondary)",
            fontFamily: '"DM Sans", sans-serif',
          }}
        >
          Or enter an emoji
        </label>
        <input
          id="icon-emoji-input"
          type="text"
          value={emoji}
          placeholder="e.g. 🏠"
          onChange={(e) => {
            const v = e.target.value;
            setEmoji(v);
            if (v.trim() !== "") onChange(v.trim());
          }}
          style={{
            minHeight: "44px",
            padding: "0 var(--space-3)",
            background: "var(--color-surface-raised)",
            border: isEmoji ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
            borderRadius: "var(--radius-input)",
            color: "var(--color-text)",
            fontSize: "var(--text-body)",
            fontFamily: '"DM Sans", sans-serif',
            outline: "none",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}
