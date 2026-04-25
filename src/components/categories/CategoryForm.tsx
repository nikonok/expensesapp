import { useState } from "react";
import BottomSheet from "../layout/BottomSheet";
import { ColorPicker } from "../shared/ColorPicker";
import { IconPicker } from "../shared/IconPicker";
import { db } from "../../db/database";
import type { Category, CategoryType } from "../../db/models";
import { getUTCISOString } from "../../utils/date-utils";
import { CHAR_LIMITS, COLOR_PALETTE, ICON_LIST } from "../../utils/constants";
import { categorySchema } from "../../utils/validation";

interface CategoryFormProps {
  isOpen: boolean;
  onClose: () => void;
  editCategory?: Category;
  defaultType: CategoryType;
}

const DEFAULT_COLOR = COLOR_PALETTE[0].value;
const DEFAULT_ICON = ICON_LIST[0];

export default function CategoryForm({
  isOpen,
  onClose,
  editCategory,
  defaultType,
}: CategoryFormProps) {
  const isEdit = !!editCategory;

  const [name, setName] = useState(editCategory?.name ?? "");
  const [color, setColor] = useState(editCategory?.color ?? DEFAULT_COLOR);
  const [icon, setIcon] = useState(editCategory?.icon ?? DEFAULT_ICON);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset form when opening/closing
  function handleClose() {
    setName(editCategory?.name ?? "");
    setColor(editCategory?.color ?? DEFAULT_COLOR);
    setIcon(editCategory?.icon ?? DEFAULT_ICON);
    setError("");
    onClose();
  }

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    if (trimmedName.length > CHAR_LIMITS.name) {
      setError(`Name must be ${CHAR_LIMITS.name} characters or fewer`);
      return;
    }

    const parseResult = categorySchema.safeParse({
      name: trimmedName,
      type: editCategory?.type ?? defaultType,
      color,
      icon,
    });
    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setSaving(true);
    try {
      const now = getUTCISOString();
      if (isEdit && editCategory?.id !== undefined) {
        await db.categories.update(editCategory.id, {
          name: trimmedName,
          color,
          icon,
          updatedAt: now,
        });
      } else {
        // Get max displayOrder
        const all = await db.categories.toArray();
        const maxOrder = all.reduce((max, c) => Math.max(max, c.displayOrder), -1);
        await db.categories.add({
          name: trimmedName,
          type: defaultType,
          color,
          icon,
          displayOrder: maxOrder + 1,
          isTrashed: false,
          createdAt: now,
          updatedAt: now,
        });
      }
      handleClose();
    } catch {
      setError("Failed to save category");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={isEdit ? "Edit Category" : "New Category"}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-5)",
          padding: "var(--space-1) var(--space-4) var(--space-6)",
        }}
      >
        {/* Name */}
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            fontFamily: '"DM Sans", sans-serif',
            fontSize: "var(--text-caption)",
            fontWeight: 500,
            color: "var(--color-text-secondary)",
          }}
        >
          Name
          <input
            type="text"
            value={name}
            maxLength={CHAR_LIMITS.name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            placeholder="Category name"
            autoFocus
            style={{
              minHeight: "44px",
              padding: "0 var(--space-3)",
              background: "var(--color-surface-raised)",
              border: `1px solid ${error ? "var(--color-expense)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-input)",
              color: "var(--color-text)",
              fontSize: "var(--text-body)",
              fontFamily: '"DM Sans", sans-serif',
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          {error && (
            <span
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--color-expense)",
              }}
            >
              {error}
            </span>
          )}
        </label>

        {/* Color */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
            }}
          >
            Color
          </span>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        {/* Icon */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          <span
            style={{
              fontFamily: '"DM Sans", sans-serif',
              fontSize: "var(--text-caption)",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
            }}
          >
            Icon
          </span>
          <IconPicker value={icon} onChange={setIcon} />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            minHeight: "44px",
            background: "var(--color-primary)",
            border: "none",
            borderRadius: "var(--radius-btn)",
            color: "var(--color-bg)",
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: "var(--text-body)",
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
            transition: "opacity 100ms ease-out",
          }}
        >
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Category"}
        </button>
      </div>
    </BottomSheet>
  );
}
