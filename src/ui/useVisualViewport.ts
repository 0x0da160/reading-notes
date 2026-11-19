import { useEffect, useState } from 'react';

export interface ViewportBox {
  top: number;
  left: number;
  width: number;
  height: number;
  /** キーボードが可視領域を狭めているとみなせる */
  keyboard: boolean;
}

/** 入力パネルを可視領域に収めるための寸法（§4.3）。ピンチズーム中はキーボードと混同しない。 */
export function useVisualViewport(active: boolean): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) {
      setBox(null);
      return;
    }
    const update = () => {
      const zoomed = vv.scale > 1.01;
      if (zoomed) {
        setBox(null);
        return;
      }
      setBox({
        top: vv.offsetTop,
        left: vv.offsetLeft,
        width: vv.width,
        height: vv.height,
        keyboard: window.innerHeight - vv.height > 120,
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return box;
}
