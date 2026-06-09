// components/linking/link-choice-dialog.tsx
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/use-t';

interface Props {
  open: boolean;
  onKeepLocal: () => void;
  onKeepRemote: () => void;
  onCancel: () => void;
}

export function LinkChoiceDialog({ open, onKeepLocal, onKeepRemote, onCancel }: Props) {
  const t = useT();
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('link.choiceTitle')}</DialogTitle>
          <DialogDescription>{t('link.choiceBody')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium text-destructive">{t('link.choiceWarning')}</p>
        <DialogFooter className="flex-col sm:flex-col">
          <Button variant="outline" className="h-9 w-full" onClick={onKeepRemote}>{t('link.choiceKeepRemote')}</Button>
          <Button variant="destructive" className="h-9 w-full" onClick={onKeepLocal}>{t('link.choiceKeepLocal')}</Button>
          <Button variant="ghost" className="h-9 w-full" onClick={onCancel}>{t('link.choiceCancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
