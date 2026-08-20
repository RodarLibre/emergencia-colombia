-- Corrects the department on records that already carry a municipality.
-- Idempotent, and safe to run more than once.
--
--   psql "$DATABASE_URL" -f src/db/department-from-municipality.sql
--
-- WHY THIS IS AN UPDATE AND NOT A NEW OBSERVATION
--
-- Invariant 2 says observations are immutable: a change creates a new one and
-- the history stays. That protects WHAT EACH SOURCE SAID AND WHEN, which is the
-- reason this project exists.
--
-- `admin1_code` is not something a source said. No feed publishes a department;
-- we derived it, and we derived it wrong — every record was stamped with the
-- first operating department, correct while the area was Valle alone and silently
-- false once coverage reached the Eje Cafetero. Pereira carried municipality
-- 66001 next to department 76.
--
-- Writing a new observation would record a change the source never made, which
-- is a worse lie than the one being fixed: it would show up in the "Cambios"
-- panel as if the place had moved department. Correcting our own derived field
-- in place loses no source claim, because there was never a claim to lose.
--
-- The municipality code is left untouched. It came from the source (or from its
-- coordinates) and it was always right.

UPDATE observations o
SET admin1_code = left(o.admin2_code, 2),
    admin1_name = m.dept_name
FROM (VALUES
  ('05','Antioquia'), ('08','Atlántico'), ('11','Bogotá, D.C.'), ('13','Bolívar'),
  ('15','Boyacá'), ('17','Caldas'), ('18','Caquetá'), ('19','Cauca'), ('20','Cesar'),
  ('23','Córdoba'), ('25','Cundinamarca'), ('27','Chocó'), ('41','Huila'),
  ('44','La Guajira'), ('47','Magdalena'), ('50','Meta'), ('52','Nariño'),
  ('54','Norte de Santander'), ('63','Quindío'), ('66','Risaralda'),
  ('68','Santander'), ('70','Sucre'), ('73','Tolima'), ('76','Valle del Cauca'),
  ('81','Arauca'), ('85','Casanare'), ('86','Putumayo'), ('88','Archipiélago de San Andrés'),
  ('91','Amazonas'), ('94','Guainía'), ('95','Guaviare'), ('97','Vaupés'), ('99','Vichada')
) AS m(dept_code, dept_name)
WHERE o.admin2_code IS NOT NULL
  AND m.dept_code = left(o.admin2_code, 2)
  AND (o.admin1_code IS DISTINCT FROM left(o.admin2_code, 2));
