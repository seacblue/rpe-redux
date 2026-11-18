/**
 * Focus ownership for the shader parameter form.
 *
 * The form's fields need to know whether focus stayed inside the shader
 * inspector after a blur. The provider tracks that through React focus events
 * and exposes refs, so a field does not search for the closest surface node.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

interface ShaderInspectorFocus {
  /** True while focus is anywhere inside the form. */
  focused: RefObject<boolean>;
  /** False after the form unmounts, so a queued blur refresh can stand down. */
  mounted: RefObject<boolean>;
}

const ShaderInspectorFocusContext = createContext<ShaderInspectorFocus | null>(null);
const DETACHED_FOCUS: ShaderInspectorFocus = {
  focused: { current: false },
  mounted: { current: false },
};

/** Provides the shader form surface and its focus refs to descendant fields. */
export function ShaderInspectorFocusProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const focused = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return (
    <ShaderInspectorFocusContext.Provider value={{ focused, mounted }}>
      <div
        className="shader-inspector"
        onFocusCapture={() => {
          focused.current = true;
        }}
        onBlurCapture={() => {
          focused.current = false;
        }}
      >
        {children}
      </div>
    </ShaderInspectorFocusContext.Provider>
  );
}

/** Reads the enclosing shader form's focus refs, or a detached fallback. */
export function useShaderInspectorFocus(): ShaderInspectorFocus {
  return useContext(ShaderInspectorFocusContext) ?? DETACHED_FOCUS;
}
