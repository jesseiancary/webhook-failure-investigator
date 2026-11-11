import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '../theme-provider';

/** App-wide toast host. Inherits the active theme so toasts match light/dark. */
function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      position="bottom-right"
      richColors
      {...props}
    />
  );
}

export { Toaster };
