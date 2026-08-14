import { useTheme } from "@/contexts/ThemeContext";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return <Sonner theme={theme} className="toaster group" style={{ "--normal-bg": "var(--surface)", "--normal-text": "var(--ink)", "--normal-border": "var(--rule)" } as React.CSSProperties} {...props} />;
};

export { Toaster };
