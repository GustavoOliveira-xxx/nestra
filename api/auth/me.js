/* GET /api/auth/me — devolve a sessão atual com os dados do usuário. */

import { asUser, environmentToClient, itemToClient, prefsToClient } from '../_lib/db.js';
import { handler, json } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const [envs, items, prefs, notifications] = await asUser(user.id, (sql) => [
    sql`select * from environments where owner_id = ${user.id} order by position`,
    sql`
      select i.*, coalesce(
               (select json_agg(json_build_object(
                  'id', c.id, 'title', c.title, 'completed', c.completed, 'position', c.position)
                  order by c.position)
                  from checklist_items c where c.item_id = i.id), '[]'::json) as checklist
        from items i
       where i.owner_id = ${user.id}
       order by i.created_at desc
       limit 1200
    `,
    sql`select * from user_preferences where user_id = ${user.id}`,
    sql`select * from notification_preferences where user_id = ${user.id}`,
  ]);

  json(res, 200, {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      timezone: user.timezone,
      locale: user.locale,
    },
    preferences: prefsToClient(prefs[0], notifications[0]),
    environments: envs.map(environmentToClient),
    items: items.map(itemToClient),
  });
});
