export interface OneLineEditorProps {
  className?: string;
}

export function OneLineEditor({ className }: OneLineEditorProps) {
  return (
    <div className={className ?? 'flex h-full w-full items-center justify-center'}>
      <div className="text-sm text-muted-foreground">OneLineEditor (scaffold)</div>
    </div>
  );
}
