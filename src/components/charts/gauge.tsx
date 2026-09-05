import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface GaugeProps {
  label:     string
  value:     number
  max:       number
  unit?:     string
  color?:    string
  className?: string
}

export function Gauge({ label, value, max, unit = '', color = '#3b82f6', className }: GaugeProps) {
  const pct  = Math.min(1, value / max)
  const data = [{ value: pct * 100, fill: color }]

  return (
    <Card className={cn('flex flex-col items-center p-4', className)}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="relative w-24 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%" cy="50%"
            innerRadius="60%" outerRadius="90%"
            startAngle={200} endAngle={-20}
            data={data}
            barSize={10}
          >
            {/* Background track */}
            <RadialBar
              dataKey="value"
              cornerRadius={5}
              background={{ fill: 'hsl(var(--muted))' }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold leading-none">
            {value.toFixed(value < 10 ? 1 : 0)}
          </span>
          <span className="text-[10px] text-muted-foreground">{unit}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        max {max}{unit}
      </p>
    </Card>
  )
}
