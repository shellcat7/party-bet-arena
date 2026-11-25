import { useConfirm } from "../../components/feedback";
import { useI18n } from "../../i18n/i18n";
import { useOpenRoom } from "../../state/AppContext";

/** Undo the latest settlement after confirmation, then reopen the result entry. */
export function useCorrectResult() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { controller, nav } = useOpenRoom();
  return async () => {
    const ok = await confirm({
      title: t("着順を訂正しますか？", "Correct the finishing order?"),
      message: t(
        "この精算を取り消し、全員の残高を精算前に戻します。ベットはそのまま残るので、着順を入力し直してください。",
        "This settlement is undone and everyone's balance returns to what it was. Tickets are kept, so you can enter the order again.",
      ),
      confirmLabel: t("精算を取り消す", "Undo settlement"),
      tone: "danger",
    });
    if (ok && (await controller.actions.undoSettlement())) nav.reset({ name: "results" });
  };
}
