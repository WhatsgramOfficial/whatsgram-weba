import { memo, useEffect, useLayoutEffect, useMemo, useRef, useSignal } from '../../../lib/teact/teact';

import type { ApiSticker } from '../../../api/types';

import { buildColor, convertColor, serializeColor } from '../../../lib/color';
import { requestMutation } from '../../../lib/fasterdom/fasterdom';
import { getStickerMediaHash } from '../../../global/helpers';
import buildClassName from '../../../util/buildClassName';
import buildStyle from '../../../util/buildStyle';
import { preloadImage } from '../../../util/files';
import { REM } from '../helpers/mediaDimensions';

import useAsync from '../../../hooks/useAsync';
import { type ObserveFn, useIsIntersecting } from '../../../hooks/useIntersectionObserver';
import useLastCallback from '../../../hooks/useLastCallback';
import useMedia from '../../../hooks/useMedia';
import useResizeObserver from '../../../hooks/useResizeObserver';
import useDevicePixelRatio from '../../../hooks/window/useDevicePixelRatio';

import styles from './RadialPatternBackground.module.scss';

type OwnProps = {
  backgroundColors?: string[];
  patternIcon?: ApiSticker;
  patternUrl?: string;
  patternColor?: string;
  patternSize?: number;
  maxRadius?: number;
  centerEmptiness?: number;
  ringsCount?: number;
  ovalFactor?: number;
  withLinearGradient?: boolean;
  className?: string;
  canvasClassName?: string;
  clearBottomSector?: boolean;
  yPosition?: number;
  withAdaptiveHeight?: boolean;
  observeIntersection?: ObserveFn;
};

const BASE_RING_ITEM_COUNT = 8;
const RING_INCREMENT = 0.5;
const DEFAULT_CENTER_EMPTINESS = 0.1;
const DEFAULT_MAX_RADIUS = 0.42;
const MIN_SIZE = 4 * REM;
const RGB_CHANNEL_MAX = 255;
const DARK_LUMA_THRESHOLD = RGB_CHANNEL_MAX * 0.2;
const COLOR_PERCENT_MAX = 100;
const LUMA_COEFFICIENTS = [0.2126, 0.7152, 0.0722] as const;

const DEFAULT_PATTERN_SIZE = 20;
const DEFAULT_RINGS_COUNT = 3;
const DEFAULT_OVAL_FACTOR = 1.4;

const RadialPatternBackground = ({
  backgroundColors,
  patternIcon,
  patternUrl,
  patternColor,
  patternSize = DEFAULT_PATTERN_SIZE,
  centerEmptiness = DEFAULT_CENTER_EMPTINESS,
  ringsCount = DEFAULT_RINGS_COUNT,
  ovalFactor = DEFAULT_OVAL_FACTOR,
  maxRadius = DEFAULT_MAX_RADIUS,
  withLinearGradient,
  clearBottomSector,
  className,
  canvasClassName,
  yPosition,
  withAdaptiveHeight,
  observeIntersection,
}: OwnProps) => {
  const containerRef = useRef<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>();

  const [getContainerSize, setContainerSize] = useSignal({ width: 0, height: 0 });

  const dpr = useDevicePixelRatio();

  const isIntersecting = useIsIntersecting(containerRef, observeIntersection);
  const shouldLoad = observeIntersection === undefined ? true : isIntersecting;

  // Load the actual sticker media (PNG preview size=m) — the same way StickerView does it.
  // This gives a proper distinct image per gift pattern, unlike thumbnail.dataUri which is a
  // generic SVG path outline (often a heart shape used as placeholder for many stickers).
  const stickerPreviewHash = patternIcon ? getStickerMediaHash(patternIcon, 'preview') : undefined;
  // `preview` size=m may not exist for custom emoji / lottie — fall back to inline (full media)
  const stickerInlineHash = patternIcon ? getStickerMediaHash(patternIcon, 'inline') : undefined;

  const previewBlobUrl = useMedia(stickerPreviewHash, !shouldLoad);
  const inlineBlobUrl = useMedia(stickerInlineHash, !shouldLoad || Boolean(previewBlobUrl || !stickerInlineHash));

  // Prefer preview (faster), fall back to inline blob, then patternUrl, then thumbnail dataUri
  const rawImageUrl = useMemo(() => {
    if (patternUrl) return patternUrl;
    if (previewBlobUrl) return previewBlobUrl;
    if (inlineBlobUrl) return inlineBlobUrl;
    return undefined;
  }, [patternUrl, previewBlobUrl, inlineBlobUrl]);

  const { result: emojiImage } = useAsync(
    async () => {
      if (!rawImageUrl || !shouldLoad) return undefined;

      const isLottie = patternIcon?.isLottie && rawImageUrl === inlineBlobUrl;
      const isVideo = patternIcon?.isVideo && rawImageUrl === inlineBlobUrl;

      if (isLottie) {
        return new Promise<HTMLCanvasElement | undefined>((resolve) => {
          let isResolved = false;
          import('../../../lib/tlottie/TLottie.async').then(({ ensureTLottie, getTLottie }) => {
            ensureTLottie().then(() => {
              const TLottie = getTLottie();
              if (!TLottie || isResolved) return;

              const container = document.createElement('div');
              container.style.position = 'absolute';
              container.style.width = '100px';
              container.style.height = '100px';
              container.style.left = '-9999px';
              container.style.top = '-9999px';
              container.style.visibility = 'hidden';
              document.body.appendChild(container);
              const renderId = `tmp_${Math.random().toString(36).slice(2)}`;
              const viewId = 'view1';

              const anim = TLottie.init(
                rawImageUrl,
                container,
                renderId,
                { size: 100, noLoop: true },
                viewId,
                undefined,
                undefined,
                undefined,
                undefined,
                (frameIndex) => {
                  if (frameIndex === 0) {
                    isResolved = true;
                    const canvas = container.querySelector('canvas');
                    if (canvas) {
                      const copy = document.createElement('canvas');
                      copy.width = canvas.width;
                      copy.height = canvas.height;
                      copy.getContext('2d')?.drawImage(canvas, 0, 0);
                      resolve(copy);
                    } else {
                      resolve(undefined);
                    }
                    anim.removeView(viewId);
                    container.remove();
                  }
                },
              );
            });
          }).catch(() => resolve(undefined));
        });
      }

      if (isVideo) {
        return new Promise<HTMLVideoElement | undefined>((resolve) => {
          const video = document.createElement('video');
          video.src = rawImageUrl;
          video.muted = true;
          video.playsInline = true;
          video.onloadeddata = () => {
            resolve(video);
          };
          video.onerror = () => resolve(undefined);
        });
      }

      return preloadImage(rawImageUrl);
    },
    [rawImageUrl, patternIcon?.isLottie, patternIcon?.isVideo, inlineBlobUrl, shouldLoad],
  );

  const patternPositions = useMemo(() => {
    const coordinates: { x: number; y: number; sizeFactor: number }[] = [];
    for (let ring = 1; ring <= ringsCount; ring++) {
      const ringItemCount = Math.floor(BASE_RING_ITEM_COUNT * (1 + (ring - 1) * RING_INCREMENT));
      const ringProgress = ring / ringsCount;
      const ringRadius = centerEmptiness + (maxRadius - centerEmptiness) * ringProgress;
      const angleShift = ring % 2 === 0 ? Math.PI / ringItemCount : 0;

      for (let i = 0; i < ringItemCount; i++) {
        const angle = (i / ringItemCount) * Math.PI * 2 + angleShift;

        if (clearBottomSector && angle > Math.PI * 0.45 && angle < Math.PI * 0.55) {
          continue;
        }

        const xOffset = ringRadius * Math.cos(angle) * ovalFactor;
        const yOffset = ringRadius * Math.sin(angle);
        const sizeFactor = 1.65 - ringProgress + Math.random() / ringsCount;

        coordinates.push({
          x: xOffset,
          y: yOffset,
          sizeFactor,
        });
      }
    }
    return coordinates;
  }, [centerEmptiness, clearBottomSector, maxRadius, ovalFactor, ringsCount]);

  useResizeObserver(containerRef, (entry) => {
    setContainerSize({
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    });
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    }
  }, [setContainerSize]);

  const draw = useLastCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !emojiImage) return;
    const ctx = canvas.getContext('2d')!;
    const { width, height } = canvas;
    if (!width || !height) return;

    const centerX = width / 2;
    const centerY = withAdaptiveHeight ? height / 2
      : yPosition !== undefined ? yPosition * dpr : width / 2;

    ctx.clearRect(0, 0, width, height);

    patternPositions.forEach(({ x, y, sizeFactor }) => {
      const renderX = x * Math.max(width, MIN_SIZE * dpr) + centerX;
      const renderY = y * Math.max(withAdaptiveHeight ? height : width, MIN_SIZE * dpr) + centerY;
      const size = patternSize * dpr * sizeFactor;

      ctx.drawImage(emojiImage, renderX - size / 2, renderY - size / 2, size, size);
    });

    // Colorize the drawn stickers
    const baseColor = backgroundColors?.[1] ?? backgroundColors?.[0] ?? '#000000';
    const isDark = getPerceivedLuma(baseColor) < DARK_LUMA_THRESHOLD;
    ctx.fillStyle = patternColor ?? buildAdjustedHsvColor(baseColor, 0.5, isDark ? 0.28 : -0.28);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillRect(0, 0, width, height);

    // Radial fade-out mask
    const radialGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * maxRadius);
    radialGradient.addColorStop(0, 'rgba(255,255,255,0.4)');
    radialGradient.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(1, 1 / ovalFactor);
    ctx.translate(-centerX, -centerY);
    ctx.fillStyle = radialGradient;
    const fillHeight = height * ovalFactor;
    ctx.fillRect(0, -fillHeight, width, fillHeight * 2);
    ctx.restore();

    ctx.globalCompositeOperation = 'source-over';
  });

  useEffect(() => {
    draw();
  }, [emojiImage, patternPositions, yPosition, ovalFactor, patternColor, backgroundColors]);

  useLayoutEffect(() => {
    const { width, height } = getContainerSize();
    const canvas = canvasRef.current;
    if (!width || !height || !canvas) {
      return;
    }

    requestMutation(() => {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      draw();
    });
  }, [getContainerSize, dpr]);

  return (
    <div
      ref={containerRef}
      className={buildClassName(
        styles.root,
        withLinearGradient && Boolean(backgroundColors?.length) && styles.withLinearGradient,
        className,
      )}
      style={buildStyle(
        backgroundColors && `--_bg-light: ${backgroundColors[0]}`,
        backgroundColors && `--_bg-dark: ${backgroundColors[1] ?? backgroundColors[0]}`,
        yPosition !== undefined && `--_y-shift: ${yPosition}px`,
      )}
    >
      <canvas
        ref={canvasRef}
        className={buildClassName(styles.canvas, emojiImage && styles.showing, canvasClassName)}
        aria-hidden="true"
      />
    </div>
  );
};

export default memo(RadialPatternBackground);

function getPerceivedLuma(color: string) {
  const [r, g, b] = convertColor(buildColor(color), 'srgb').coords;
  const [rc, gc, bc] = LUMA_COEFFICIENTS;
  return rc * (r! * RGB_CHANNEL_MAX) + gc * (g! * RGB_CHANNEL_MAX) + bc * (b! * RGB_CHANNEL_MAX);
}

function buildAdjustedHsvColor(color: string, satDelta: number, valDelta: number) {
  const parsedColor = buildColor(color);
  const [h, initialS, initialV] = convertColor(parsedColor, 'hsv').coords;
  let s = initialS! / COLOR_PERCENT_MAX;
  let v = initialV! / COLOR_PERCENT_MAX;

  if (s > 0.1 && s < 0.9) s = Math.max(0, Math.min(1, s + satDelta));
  v = Math.max(0, Math.min(1, v + valDelta));

  return serializeColor({
    space: 'hsv',
    coords: [h || 0, s * COLOR_PERCENT_MAX, v * COLOR_PERCENT_MAX],
    alpha: parsedColor.alpha,
  }, { format: 'hex', collapse: false, alpha: true });
}
