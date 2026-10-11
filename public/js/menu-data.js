// Default Royal Rasoi menu (from the printed Indo-Chinese and Indo-Italian menus).
// Load it once from the dashboard: Menu → "Load default menu". After that, edit prices in the dashboard.

const SML = (s, m, l) => [
  { label: 'Small 8"', price: s },
  { label: 'Medium 10"', price: m },
  { label: 'Large 12"', price: l },
];
const HF = (h, f) => [{ label: "Half", price: h }, { label: "Full", price: f }];
const ONE = (p) => [{ label: "", price: p }];

const PIZZAS = ["Pizza Margherita", "Pizza Farmhouse", "Chicken Pizza", "Corn Cheese Pizza", "Veg Pizza", "Royal Cheese Margherita"];
const BURGERS = ["Veg Classic Burger", "Chicken Patty Burger"];

const raw = [
  // ---------- Indo-Chinese ----------
  ["chinese", "Starters", "Veg Spring Roll", "", true, HF(50, 95)],
  ["chinese", "Starters", "Chilli Paneer Dry", "", true, HF(75, 145)],
  ["chinese", "Starters", "Chilli Chicken Dry", "", false, HF(95, 180)],
  ["chinese", "Starters", "Chicken Lollipop", "", false, HF(110, 215)],
  ["chinese", "Soups", "Hot & Sour Soup", "", true, HF(25, 45)],
  ["chinese", "Soups", "Manchow Soup", "", true, HF(25, 50)],
  ["chinese", "Momos", "Veg Momos", "", true, HF(40, 70)],
  ["chinese", "Momos", "Chicken Momos", "", false, HF(55, 105)],
  ["chinese", "Main Course", "Hakka Noodles", "", true, HF(40, 80)],
  ["chinese", "Main Course", "Chicken Hakka Noodles", "", false, HF(65, 125)],
  ["chinese", "Main Course", "Veg Fried Rice", "", true, HF(40, 75)],
  ["chinese", "Main Course", "Chicken Fried Rice", "", false, HF(65, 125)],
  ["chinese", "Main Course", "Chilli Paneer Gravy", "", true, HF(75, 150)],
  ["chinese", "Main Course", "Chicken in Schezwan Sauce", "", false, HF(85, 165)],
  ["chinese", "Main Course", "Chicken Chilli Gravy", "", false, HF(80, 155)],
  ["chinese", "Main Course", "Kung Pao Chicken", "", false, HF(95, 180)],
  ["chinese", "Breads", "Garlic Naan", "", true, ONE(45)],
  ["chinese", "Breads", "Butter Naan", "", true, ONE(40)],
  ["chinese", "Breads", "Tandoori Roti", "", true, ONE(15)],
  ["chinese", "Breads", "Butter Roti", "", true, ONE(20)],
  ["chinese", "Noodles Combo", "Combo 1 – Starter + Noodles + Coke", "1 Starter + 1 Noodles + 1 Coke", false, ONE(149),
    [{ name: "Type", options: ["Veg", "Chicken"] }]],
  ["chinese", "Noodles Combo", "Combo 2 – Starter + Fried Rice + Coke", "1 Starter + 1 Fried Rice + 1 Coke", false, ONE(149),
    [{ name: "Type", options: ["Veg", "Chicken"] }]],
  // ---------- Indo-Italian ----------
  ["italian", "Pizza", "Pizza Margherita", "Tomato, basil", true, SML(89, 179, 279)],
  ["italian", "Pizza", "Pizza Farmhouse", "Onion, capsicum, mushroom, broccoli", true, SML(119, 199, 299)],
  ["italian", "Pizza", "Chicken Pizza", "Chicken rashers, onion", false, SML(129, 219, 329)],
  ["italian", "Pizza", "Corn Cheese Pizza", "Corn, parmesan cheese", true, SML(119, 199, 299)],
  ["italian", "Pizza", "Veg Pizza", "Onion, capsicum, broccoli, corn", true, SML(109, 189, 289)],
  ["italian", "Pizza", "Royal Cheese Margherita", "2 cheese", true, SML(139, 229, 349)],
  ["italian", "Burgers", "Veg Classic Burger", "", true, ONE(49)],
  ["italian", "Burgers", "Chicken Patty Burger", "", false, ONE(59)],
  ["italian", "Pizza Combo", "Combo 1 – Small Pizza + Burger + Coke", "Any small pizza + burger + Coke", false, ONE(189),
    [{ name: "Pizza (Small)", options: PIZZAS }, { name: "Burger", options: BURGERS }]],
  ["italian", "Pizza Combo", "Combo 2 – Medium Pizza + Burger + Coke", "Any medium pizza + burger + Coke", false, ONE(249),
    [{ name: "Pizza (Medium)", options: PIZZAS }, { name: "Burger", options: BURGERS }]],
  // ---------- Beverages ----------
  ["beverage", "Beverages", "Coke", "", true, ONE(50)],
  ["beverage", "Beverages", "Sprite", "", true, ONE(50)],
  ["beverage", "Beverages", "Thums Up", "", true, ONE(50)],
  ["beverage", "Beverages", "Fanta", "", true, ONE(50)],
];

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const DEFAULT_MENU = raw.map(([cuisine, category, name, desc, veg, variants, optionGroups], i) => ({
  id: `${cuisine}-${slug(name)}`,
  cuisine, category, name, desc, veg, variants,
  optionGroups: optionGroups || [],
  available: true,
  image: "",
  sort: (i + 1) * 10,
}));
