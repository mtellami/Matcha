import { Button as HeroButton } from "@heroui/react";

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  className?: string;
  variant?: "primary" | "secondary" | "quiet";
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function UiButton({
  className = "",
  variant,
  disabled,
  onClick,
  ...props
}: Props) {
  return (
    <HeroButton
      {...(props as any)}
      isDisabled={disabled}
      onPress={(event: any) =>
        onClick?.(event as React.MouseEvent<HTMLButtonElement>)
      }
      variant={
        variant === "quiet"
          ? "ghost"
          : variant === "primary"
            ? "primary"
            : "secondary"
      }
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-matcha-border bg-matcha-surface px-4 py-2 text-matcha-text transition-colors hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent disabled:cursor-wait disabled:opacity-50 ${className}`}
    />
  );
}
