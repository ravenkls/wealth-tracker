import { Overview } from "../features/overview/Overview";
import { overviewFixture } from "./fixture";
import { SnapshotPreview } from "./SnapshotPreview";
export default function Preview({
  recordOpen,
  onClose,
}: {
  readonly recordOpen: boolean;
  readonly onClose: () => void;
}) {
  return (
    <>
      <Overview data={overviewFixture} />
      <SnapshotPreview open={recordOpen} onClose={onClose} />
    </>
  );
}
