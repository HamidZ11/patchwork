import { NotFoundMessage } from '@/components/not-found-message';

/** A repository or report the signed-in reader cannot open: inside the app
 * shell, with the way back to their repositories. */
export default function AppNotFound() {
  return <NotFoundMessage href="/repositories" label="Back to repositories" />;
}
