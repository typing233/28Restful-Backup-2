export function TaskStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: 'bg-gray-700 text-gray-300',
    running: 'bg-blue-900/50 text-blue-300',
    completed: 'bg-green-900/50 text-green-300',
    failed: 'bg-red-900/50 text-red-300',
    cancelled: 'bg-yellow-900/50 text-yellow-300',
    timeout: 'bg-orange-900/50 text-orange-300',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${styles[status] || 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  );
}
