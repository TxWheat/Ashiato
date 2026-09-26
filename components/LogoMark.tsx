/** The Ashiato mark: a chain of blocks, the newest one in the crosshairs (same drawing as app/icon.svg) */
export default function LogoMark({ size = 22, className, tile = false }: { size?: number; className?: string; tile?: boolean }) {
  // On the page the mark stands on its own, cropped to the drawing; the dark tile is for icons
  // Block faces: light on the dark tile, indigo shades on the page (readable in light and dark)
  const face = tile ? ['#fff', '#D9D5FF', '#A99FFF'] : ['#9B92FF', '#6D61F0', '#4B3FCF']
  return (
    <svg viewBox={tile ? '0 0 512 512' : '80 40 400 400'} width={size} height={size} className={className} aria-hidden="true">
      {tile && <rect width="512" height="512" rx="116" fill="#15151b" />}
      <path d="M140 392 L246 272 L352 152" stroke="#7B70FF" strokeWidth="14" strokeLinecap="round"/>
      <g transform="translate(140 392)" fillOpacity=".45"><path d="M0 -50 L43 -25 L0 0 L-43 -25 Z" fill={face[0]}/>
      <path d="M-43 -25 L0 0 L0 50 L-43 25 Z" fill={face[1]}/>
      <path d="M43 -25 L0 0 L0 50 L43 25 Z" fill={face[2]}/>
      </g>
      <g transform="translate(246 272)" fillOpacity=".75"><path d="M0 -50 L43 -25 L0 0 L-43 -25 Z" fill={face[0]}/>
      <path d="M-43 -25 L0 0 L0 50 L-43 25 Z" fill={face[1]}/>
      <path d="M43 -25 L0 0 L0 50 L43 25 Z" fill={face[2]}/>
      </g>
      <g transform="translate(352 152)" fillOpacity="1"><path d="M0 -54 L46 -27 L0 0 L-46 -27 Z" fill={face[0]}/>
      <path d="M-46 -27 L0 0 L0 54 L-46 27 Z" fill={face[1]}/>
      <path d="M46 -27 L0 0 L0 54 L46 27 Z" fill={face[2]}/>
      </g>
      <g stroke={tile ? "#fff" : "currentColor"} strokeWidth="12" strokeLinecap="round" fill="none"><circle cx="352" cy="152" r="84"/>
      <path d="M352 52 v30 M352 222 v30 M252 152 h30 M422 152 h30"/>
      </g>
    </svg>
  )
}
