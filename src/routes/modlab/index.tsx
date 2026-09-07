import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function ModLabPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Mod Lab</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Era comparison — matched-cell analysis across modifications
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Era management</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Currently in era: <strong>Stock</strong>
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            Era-based matched-cell comparison (boost, timing, fuel trims, lambda, rail pressure)
            will be available once multiple eras are defined. Define eras by date or odometer
            to compare before/after modifications.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/modlab/')({
  component: ModLabPage,
})
