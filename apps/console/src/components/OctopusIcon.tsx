/**
 * 可爱章鱼图标 — Octopus AI 品牌 Logo
 * 风格：圆润 kawaii 风，简洁现代
 */
import { cn } from '@/lib/utils';

interface OctopusIconProps {
  className?: string;
  animated?: boolean;
}

export function OctopusIcon({ className, animated = false }: OctopusIconProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(animated && 'animate-bounce-gentle', className)}
    >
      {/* 触手 — 6条柔软弯曲，从身体底部自然伸出 */}
      <path d="M30 68 C26 78, 18 88, 22 96 C24 100, 28 98, 28 94 C28 90, 30 82, 34 74" fill="currentColor" opacity="0.75" />
      <path d="M42 74 C38 84, 32 96, 36 104 C38 108, 42 106, 42 102 C42 96, 44 86, 46 78" fill="currentColor" opacity="0.75" />
      <path d="M56 76 C54 88, 52 100, 56 108 C58 112, 62 110, 62 106 C62 100, 60 90, 60 78" fill="currentColor" opacity="0.75" />
      <path d="M64 76 C66 88, 68 100, 64 108 C62 112, 58 110, 58 106" fill="currentColor" opacity="0" />
      <path d="M74 74 C76 86, 82 96, 80 104 C78 108, 74 106, 74 102 C74 96, 72 86, 70 78" fill="currentColor" opacity="0.75" />
      <path d="M86 68 C90 78, 98 88, 94 96 C92 100, 88 98, 88 94 C88 90, 86 82, 82 74" fill="currentColor" opacity="0.75" />
      {/* 中间两条 */}
      <path d="M48 76 C46 86, 42 98, 46 106 C48 110, 52 108, 52 104 C52 98, 50 88, 52 78" fill="currentColor" opacity="0.75" />
      <path d="M68 76 C70 86, 74 98, 70 106 C68 110, 64 108, 64 104 C64 98, 66 88, 66 78" fill="currentColor" opacity="0.75" />

      {/* 身体 — 大圆球，可爱的椭圆形 */}
      <ellipse cx="60" cy="48" rx="34" ry="32" fill="currentColor" />

      {/* 身体高光 */}
      <ellipse cx="48" cy="34" rx="14" ry="10" fill="white" opacity="0.15" />

      {/* 左眼 — 大而圆 */}
      <ellipse cx="46" cy="46" rx="9" ry="10" fill="white" />
      <ellipse cx="48" cy="48" rx="5.5" ry="6.5" fill="#312e81" />
      <circle cx="50" cy="45" r="2.5" fill="white" />
      <circle cx="46" cy="50" r="1.2" fill="white" opacity="0.6" />

      {/* 右眼 — 大而圆 */}
      <ellipse cx="74" cy="46" rx="9" ry="10" fill="white" />
      <ellipse cx="72" cy="48" rx="5.5" ry="6.5" fill="#312e81" />
      <circle cx="74" cy="45" r="2.5" fill="white" />
      <circle cx="70" cy="50" r="1.2" fill="white" opacity="0.6" />

      {/* 嘴巴 — 开心的弧线 */}
      <path d="M52 58 Q60 66 68 58" stroke="#312e81" strokeWidth="2.5" strokeLinecap="round" fill="none" />

      {/* 腮红 */}
      <ellipse cx="38" cy="56" rx="5" ry="3" fill="#fda4af" opacity="0.5" />
      <ellipse cx="82" cy="56" rx="5" ry="3" fill="#fda4af" opacity="0.5" />

      {/* 头顶小皇冠/光点装饰 */}
      <circle cx="60" cy="18" r="2" fill="currentColor" opacity="0.4" />
      <circle cx="52" cy="20" r="1.5" fill="currentColor" opacity="0.3" />
      <circle cx="68" cy="20" r="1.5" fill="currentColor" opacity="0.3" />
    </svg>
  );
}
