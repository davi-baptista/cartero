import { ContextHeading } from '@/components/ui/context-heading'

type MovementContextHeadingProps = {
  title: string
  subtitle: string
  explanation: string
}

export function MovementContextHeading({ title, subtitle, explanation }: MovementContextHeadingProps) {
  return (
    <ContextHeading
      title={title}
      description={subtitle}
      infoContent={explanation}
      infoLabel={`Sobre ${title.toLocaleLowerCase('pt-BR')}`}
    />
  )
}
