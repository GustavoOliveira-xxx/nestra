import {
  asUser, environmentToClient, itemToClient, prefsToClient,
  meetingToClient, agendaToClient,
} from './db.js';

export async function accountState(user) {
  const [envs, items, prefs, notifications, meetings, agendas] = await asUser(user.id, (sql) => [
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
    sql`select * from meetings where owner_id = ${user.id} order by created_at`,
    sql`
      select * from meeting_agendas
       where owner_id = ${user.id} and occurs_on > current_date - 90
       order by occurs_on desc
       limit 400
    `,
  ]);

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? user.display_name,
      timezone: user.timezone,
      locale: user.locale,
    },
    preferences: prefsToClient(prefs[0], notifications[0]),
    environments: envs.map(environmentToClient),
    items: items.map(itemToClient),
    meetings: meetings.map(meetingToClient),
    agendas: agendas.map(agendaToClient),
  };
}
