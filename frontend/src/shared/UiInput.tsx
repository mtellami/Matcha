import { Input as HeroInput, TextArea as HeroTextArea } from "@heroui/react";

export function UiInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    ref?: React.Ref<HTMLInputElement>;
  },
) {
  return (
    <HeroInput
      {...(props as any)}
      className={`ui-input min-h-12 min-w-0 rounded-xl border border-matcha-border bg-matcha-bg px-3.5 py-2.5 text-[15px] font-normal text-matcha-text placeholder:text-matcha-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent ${props.className ?? ""}`}
    />
  );
}

export function UiTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <HeroTextArea
      {...(props as any)}
      className={`ui-input min-h-32 min-w-0 rounded-xl border border-matcha-border bg-matcha-bg px-3.5 py-3 text-[15px] font-normal leading-relaxed text-matcha-text placeholder:text-matcha-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent ${props.className ?? ""}`}
    />
  );
}
