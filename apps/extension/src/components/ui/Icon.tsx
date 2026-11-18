// One icon set (Lucide, ISC) behind meaningful names, so the same action always shows the same
// glyph. Every icon is 16 px with a 1.75 px stroke.
import ArrowDown from '@lucide/solid/icons/arrow-down';
import ArrowUp from '@lucide/solid/icons/arrow-up';
import Ban from '@lucide/solid/icons/ban';
import Binary from '@lucide/solid/icons/binary';
import CaseSensitive from '@lucide/solid/icons/case-sensitive';
import Check from '@lucide/solid/icons/check';
import ChevronDown from '@lucide/solid/icons/chevron-down';
import ChevronRight from '@lucide/solid/icons/chevron-right';
import ChevronsDownUp from '@lucide/solid/icons/chevrons-down-up';
import ChevronsUpDown from '@lucide/solid/icons/chevrons-up-down';
import Circle from '@lucide/solid/icons/circle';
import CircleAlert from '@lucide/solid/icons/circle-exclamation-point';
import CircleHelp from '@lucide/solid/icons/circle-question-mark';
import Command from '@lucide/solid/icons/command';
import Cookie from '@lucide/solid/icons/cookie';
import Copy from '@lucide/solid/icons/copy';
import Download from '@lucide/solid/icons/download';
import Ellipsis from '@lucide/solid/icons/ellipsis';
import Eye from '@lucide/solid/icons/eye';
import EyeOff from '@lucide/solid/icons/eye-off';
import Info from '@lucide/solid/icons/info';
import KeyRound from '@lucide/solid/icons/key-round';
import Filter from '@lucide/solid/icons/list-filter';
import MapIcon from '@lucide/solid/icons/map';
import Pause from '@lucide/solid/icons/pause';
import Plus from '@lucide/solid/icons/plus';
import RotateCcw from '@lucide/solid/icons/rotate-ccw';
import Save from '@lucide/solid/icons/save';
import Search from '@lucide/solid/icons/search';
import Send from '@lucide/solid/icons/send';
import Settings from '@lucide/solid/icons/settings';
import Trash from '@lucide/solid/icons/trash';
import TriangleAlert from '@lucide/solid/icons/triangle-exclamation-point';
import Undo from '@lucide/solid/icons/undo-2';
import Upload from '@lucide/solid/icons/upload';
import X from '@lucide/solid/icons/x';
import { Dynamic } from '@solidjs/web';

const ICONS = {
  binary: Binary,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  clear: Ban,
  close: X,
  collapse: ChevronsDownUp,
  command: Command,
  cookie: Cookie,
  copy: Copy,
  error: CircleAlert,
  expand: ChevronsUpDown,
  export: Download,
  eye: Eye,
  'eye-off': EyeOff,
  filter: Filter,
  help: CircleHelp,
  import: Upload,
  info: Info,
  key: KeyRound,
  'match-case': CaseSensitive,
  more: Ellipsis,
  next: ArrowDown,
  pause: Pause,
  plus: Plus,
  previous: ArrowUp,
  record: Circle,
  replay: RotateCcw,
  save: Save,
  search: Search,
  send: Send,
  settings: Settings,
  sourcemap: MapIcon,
  trash: Trash,
  undo: Undo,
  warning: TriangleAlert,
};

export type IconName = keyof typeof ICONS;

/** Decorative unless `label` is given; buttons carry their own accessible name. */
export default function Icon(props: { name: IconName; label?: string | undefined }) {
  return (
    <Dynamic
      component={ICONS[props.name]}
      size={16}
      aria-hidden={props.label ? undefined : 'true'}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
    />
  );
}
