// Transport icons (design decision 5b: icons only, with labels for assistive technology and tooltips).
const paths = {
  previous: 'M6 5h2v14H6zM20 5v14L9 12z',
  play: 'M7 4v16l13-8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  next: 'M16 5h2v14h-2zM4 5v14l11-7z',
  replay: 'M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  caption: 'M4 5h16v11H8l-4 4zM7 9h10v2H7z',
  voiceOn: 'M4 9v6h4l5 5V4L8 9zM16 8a5 5 0 0 1 0 8l-1-1.4a3.3 3.3 0 0 0 0-5.2z',
  voiceOff: 'M4 9v6h4l5 5V4L8 9zM16 9l5 6M21 9l-5 6',
}

export type IconName = keyof typeof paths

export function Icon({ name }: { name: IconName }) {
  const stroke = name === 'voiceOff'
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={paths[name]} fill={stroke ? 'none' : 'currentColor'} stroke={stroke ? 'currentColor' : 'none'} strokeWidth="2" />
    </svg>
  )
}
