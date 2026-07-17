// Extra (non-canonical) UI + library locale tables. Each is partial; any key
// not present falls back to English at lookup time (see ../messages, ../library).
import es from './es';
import fr from './fr';
import de from './de';
import pt from './pt';
import ja from './ja';
import ru from './ru';
import fa from './fa';
import ar from './ar';
import he from './he';

export const EXTRA_LOCALES = { es, fr, de, pt, ja, ru, fa, ar, he };

/** Locale codes whose script is right-to-left (text only; layout stays LTR). */
export const RTL_LOCALES = ['fa', 'ar', 'he'] as const;
