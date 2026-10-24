import * as met from './met.js';
import * as aic from './aic.js';
import * as cleveland from './cleveland.js';
import * as vam from './vam.js';

export const MUSEUMS = {
  met: {
    ...met,
    slug: 'met', name: 'The Metropolitan Museum of Art', short: 'The Met',
    city: 'New York', country: 'United States', url: 'https://www.metmuseum.org',
  },
  aic: {
    ...aic,
    slug: 'aic', name: 'Art Institute of Chicago', short: 'Art Institute',
    city: 'Chicago', country: 'United States', url: 'https://www.artic.edu',
  },
  cleveland: {
    ...cleveland,
    slug: 'cleveland', name: 'The Cleveland Museum of Art', short: 'Cleveland',
    city: 'Cleveland', country: 'United States', url: 'https://www.clevelandart.org',
  },
  vam: {
    ...vam,
    slug: 'vam', name: 'Victoria and Albert Museum', short: 'V&A',
    city: 'London', country: 'United Kingdom', url: 'https://www.vam.ac.uk',
  },
};

export function museumInfo(slug) {
  const m = MUSEUMS[slug];
  return m && { slug: m.slug, name: m.name, short: m.short, city: m.city, country: m.country, url: m.url };
}
