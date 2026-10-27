import { TxnForm } from "./TxnForm";
import { Sheet } from "./ui";

export function QuickAddSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="New transaction" onClose={onClose}>
      <TxnForm onDone={onClose} />
    </Sheet>
  );
}
