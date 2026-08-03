import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Smile } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Common budget-category emoji. Not exhaustive — a free-text field below the
 * grid covers anything else, so this list only needs to save clicks for the
 * common case, not enumerate every emoji.
 */
const CURATED_EMOJI = [
  '💵', '💰', '🤑', '📈', '💳', '🏦',
  '🏡', '🏠', '💡', '🧾', '🛒',
  '🍔', '🍕', '☕',
  '🏥', '💊',
  '🚙', '🚗', '✈️',
  '🎓', '📚',
  '🏝️', '🎉', '🎭', '🎮',
  '🛍️', '👕',
  '🎁', '🎗️', '❤️',
  '👶', '🐶',
] as const;

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  className?: string;
  'aria-label'?: string;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({
  value,
  onChange,
  className,
  'aria-label': ariaLabel = 'Choose an emoji',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="h-10 w-10 text-lg"
      >
        {value || <Smile className="h-4 w-4 text-muted-foreground" />}
      </Button>

      {open && (
        <div
          className="absolute z-20 mt-1 w-56 rounded-md border border-input bg-popover p-2 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-6 gap-1">
            {CURATED_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Use ${emoji}`}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
                className="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-secondary"
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Or paste any emoji"
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && setOpen(false)}
            />
            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => onChange('')}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmojiPicker;
