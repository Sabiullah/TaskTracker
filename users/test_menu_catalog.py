from django.test import SimpleTestCase

from users.menu_catalog import ALL_CODES, FEATURE_TO_CODE, MENU_CATALOG, top_level_code


class MenuCatalogTests(SimpleTestCase):
    def test_codes_are_unique(self):
        codes = [n.code for n in MENU_CATALOG]
        self.assertEqual(len(codes), len(set(codes)))

    def test_parents_exist_and_precede_children(self):
        seen: set[str] = set()
        top_level: set[str] = set()
        for node in MENU_CATALOG:
            if node.parent is None:
                top_level.add(node.code)
            else:
                self.assertIn(node.parent, top_level, f"{node.code} parent missing/out of order")
                self.assertTrue(node.code.startswith(node.parent + "."))
            seen.add(node.code)

    def test_submenu_codes_dotted_under_parent(self):
        self.assertEqual(top_level_code("employee.salary"), "employee")
        self.assertEqual(top_level_code("board"), "board")

    def test_all_codes_matches_catalog(self):
        self.assertEqual(ALL_CODES, {n.code for n in MENU_CATALOG})

    def test_feature_map_targets_are_real_codes(self):
        for code in FEATURE_TO_CODE.values():
            self.assertIn(code, ALL_CODES)
