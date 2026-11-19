// One draggable, keyboard-operable separator, used between the outline and the agent and beside the side columns.

export function Divider(props: {
  orientation: 'horizontal' | 'vertical'
  label: string
  value: number
  min: number
  max: number
  className: string
  /** Called with the pointer's position (client coordinates) while the divider is dragged. */
  onDrag: (pointer: { x: number; y: number }) => void
  /** Called for an arrow key: -1 toward the top or left, 1 toward the bottom or right. */
  onStep: (direction: -1 | 1) => void
  onReset?: () => void
}) {
  const { orientation, label, value, min, max, className, onDrag, onStep, onReset } = props

  return (
    <div
      className={className}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        // The handler of the render that started the drag is used throughout; the callers only read refs and stable setters.
        const move = (e: PointerEvent) => {
          onDrag({ x: e.clientX, y: e.clientY })
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') onStep(-1)
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') onStep(1)
        else return
        event.preventDefault()
      }}
      onDoubleClick={onReset}
    />
  )
}
